import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, createWorld, removePlayer, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { parseLevel } from "../../src/sim/level.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, elevationAt } from "../../src/sim/terrain.js";
import { AiState, Outcome, Phase } from "../../src/sim/types.js";
import type { EnemyState, PlayerState } from "../../src/sim/types.js";
import { ENEMY_HALF, PLAYER_EYE_OFFSET, PLAYER_MAX_HEALTH, SIM_TICK_HZ } from "../../src/sim/constants.js";
import { HOLLOW_STALK_SPEED, playerSees, spawnHollow, spawnHollowStepping } from "../../src/sim/hollow.js";
import { spawnShade } from "../../src/sim/haunt.js";
import { HOLLOW_PACK_MAX, RETURN_AFTER_S, RETURN_HOLD_S, held, returnsOn } from "../../src/sim/checkpoint.js";
import { returnHollowAt } from "../../src/sim/returns.js";
import { SHOTS } from "../../src/game/cutscene.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");
const SUITE = { timeout: timeLimit(120_000) };
const RETURN_TICKS = RETURN_AFTER_S * SIM_TICK_HZ;
const HOLD_TICKS = RETURN_HOLD_S * SIM_TICK_HZ;

type W = ReturnType<typeof createForestWorld>;
const tick = (w: W, n: number) => { for (let i = 0; i < n; i++) tickWorld(w, new Map()); };
const groundY = (x: number, z: number) => elevationAt(seed, x, z);
const standAt = (p: { pos: { x: number; y: number; z: number } }, x: number, z: number, half = 0.9) => { p.pos = { x, y: groundY(x, z) + half, z }; };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
/** The Hollows that hunt: not the shades, not the watcher. */
const pack = (w: W): EnemyState[] => [...w.state.enemies.values()].filter((e) => e.ai === AiState.Hunt || e.ai === AiState.Emerge || e.ai === AiState.Stand);

/**
 * A forest match in the chase: `players` hikers found the body together, the
 * scene is over, and the summit's Hollow hunts the first of them from 60 m
 * down the far side, out of reach.
 */
function chase(players = 1) {
  const w = createForestWorld(createForest(seed));
  w.haunt!.active = false;
  const ps: PlayerState[] = [];
  for (let i = 0; i < players; i++) ps.push(spawnPlayer(w));
  const body = w.search!.body.pos;
  standAt(ps[0]!, body.x - 5, body.z);
  tick(w, 1);
  expect(w.state.phase).toBe(Phase.Scene);
  const h = [...w.state.enemies.values()][0]!;
  w.state.phase = Phase.Chase;
  h.ai = AiState.Hunt; h.stateTimer = 0; h.targetId = ps[0]!.id;
  standAt(h, body.x + 60, body.z, ENEMY_HALF.y);
  return { w, ps, p: ps[0]!, h, body };
}
/**
 * Stands `h` a few metres from `q`, wherever round them the ground gives a
 * clear line, and turns `q` to look straight at it. Returns the command that
 * keeps them looking.
 */
function lookAt(w: W, q: PlayerState, h: EnemyState) {
  for (const [dx, dz] of [[-8, 0], [8, 0], [0, 8], [0, -8], [-6, 6], [6, -6], [-5, 0], [5, 0], [0, 5], [0, -5], [-12, 0], [12, 0]] as const) {
    standAt(h, q.pos.x + dx, q.pos.z + dz, ENEMY_HALF.y);
    q.yaw = Math.atan2(h.pos.x - q.pos.x, h.pos.z - q.pos.z);
    q.pitch = Math.atan2(h.pos.y - (q.pos.y + PLAYER_EYE_OFFSET), Math.sqrt(dx * dx + dz * dz));
    if (playerSees(q, h, w)) break;
  }
  expect(playerSees(q, h, w), "no clear line found round the survivor").toBe(true);
  return { seq: 1, moveX: 0, moveZ: 0, yaw: q.yaw, pitch: q.pitch, buttons: 0 };
}

/** Puts `h` on `p` and ticks once: its touch kills them. */
function kill(w: W, p: PlayerState, h: EnemyState) {
  h.pos = { x: p.pos.x + 0.3, y: p.pos.y - 0.9 + ENEMY_HALF.y, z: p.pos.z };
  if (h.ai !== AiState.Emerge) { h.ai = AiState.Hunt; h.targetId = p.id; }
  tick(w, 1);
  expect(p.health).toBe(0);
}

describe("a death in the chase", SUITE, () => {
  it("comes back on the crest after RETURN_AFTER_S, alive, where the party stood at the find, the match still on", () => {
    const { w, p, h } = chase();
    const found = { x: p.pos.x, z: p.pos.z, yaw: p.yaw };
    standAt(p, found.x - 80, found.z);
    p.stare = 0.8;
    expect(returnsOn(w)).toBe(true);
    kill(w, p, h);
    tick(w, RETURN_TICKS - 1);
    expect(p.health).toBe(0);
    expect(w.state.outcome).toBe(Outcome.Playing);
    tick(w, 1);
    expect(p.health).toBe(PLAYER_MAX_HEALTH);
    expect(p.deathPos).toBeNull();
    expect(dist(p.pos, found)).toBeLessThan(0.01);
    expect(p.pos.y).toBeCloseTo(groundY(found.x, found.z) + 0.9, 1);
    expect(p.yaw).toBe(found.yaw);
    expect(p.stare).toBe(0);
    expect(held(p)).toBe(true);
    expect(w.state.outcome).toBe(Outcome.Playing);
    expect(w.state.phase).toBe(Phase.Chase);
  });

  it("is met by the Hollow that killed them, moved: stepping out past the body, walking at them at the stalk's pace, then hunting", () => {
    const { w, p, h, body } = chase();
    kill(w, p, h);
    tick(w, RETURN_TICKS);
    expect(pack(w).map((e) => e.id)).toEqual([h.id]);
    expect(h.ai).toBe(AiState.Emerge);
    expect(h.targetId).toBe(p.id);
    // Past the body from the player, already a little into its walk.
    expect(dist(h.pos, body)).toBeLessThan(dist(h.pos, p.pos));
    const from = dist(h.pos, p.pos);
    tick(w, SIM_TICK_HZ);
    const walked = from - dist(h.pos, p.pos);
    expect(walked).toBeGreaterThan(HOLLOW_STALK_SPEED * 0.6);
    expect(walked).toBeLessThan(HOLLOW_STALK_SPEED * 1.2);
    // (One tick over: the timer is seconds counted down in sixtieths.)
    tick(w, HOLD_TICKS - SIM_TICK_HZ + 1);
    expect(h.ai).toBe(AiState.Hunt);
  });

  it("holds the returning player for RETURN_HOLD_S: nothing kills them, then anything does", () => {
    const { w, p, h } = chase();
    kill(w, p, h);
    tick(w, RETURN_TICKS);
    const other = spawnHollow(w, { x: p.pos.x + 0.3, y: p.pos.y - 0.9 + ENEMY_HALF.y, z: p.pos.z }, p.id, 0);
    for (let i = 0; i < HOLD_TICKS - 1; i++) {
      // Standing on them the whole time, and their own Hollow too.
      other.pos = { x: p.pos.x + 0.3, y: other.pos.y, z: p.pos.z };
      h.pos = { x: p.pos.x - 0.3, y: h.pos.y, z: p.pos.z };
      tick(w, 1);
      expect(p.health, `tick ${i} of the hold`).toBe(PLAYER_MAX_HEALTH);
    }
    expect(held(p)).toBe(true);
    tick(w, 1);
    expect(held(p)).toBe(false);
    other.pos = { x: p.pos.x + 0.3, y: other.pos.y, z: p.pos.z };
    tick(w, 1);
    expect(p.health).toBe(0);
  });

  it("holds as long as the scene's last shot runs", () => {
    expect(RETURN_HOLD_S).toBe(SHOTS[4]);
  });

  it("alone, withdraws every other Hollow", () => {
    const { w, p, h, body } = chase();
    const at = { x: body.x - 120, y: groundY(body.x - 120, body.z) + ENEMY_HALF.y, z: body.z };
    const stepping = spawnHollowStepping(w, at, at, p.id);
    const idle = spawnHollow(w, { x: body.x - 200, y: groundY(body.x - 200, body.z) + ENEMY_HALF.y, z: body.z }, p.id, 0);
    kill(w, p, h);
    tick(w, RETURN_TICKS);
    expect(pack(w).map((e) => e.id)).toEqual([h.id]);
    expect(w.state.enemies.has(stepping.id)).toBe(false);
    expect(w.state.enemies.has(idle.id)).toBe(false);
  });

  it("alone, keeps the pack the size it was however often the player dies", () => {
    const { w, p, h } = chase();
    let after = -1;
    for (let death = 1; death <= 10; death++) {
      kill(w, p, [...pack(w)].find((e) => e.targetId === p.id) ?? h);
      tick(w, RETURN_TICKS + HOLD_TICKS + 1);
      expect(p.health, `return ${death}`).toBe(PLAYER_MAX_HEALTH);
      if (after < 0) after = w.state.enemies.size;
      expect(w.state.enemies.size, `after return ${death}`).toBe(after);
    }
    expect(after).toBe(1);
  });

  it("in a party, moves the killer only when no survivor can see it go; seen, it stays and a new one rises", () => {
    const { w, ps, p, h, body } = chase(2);
    const q = ps[1]!;
    // The survivor far down the stem, and (for the test's length) beyond any Hollow's touch.
    standAt(q, body.x - 300, body.z);
    q.heldFor = 1_000_000;
    standAt(p, body.x - 70, body.z);
    kill(w, p, h);
    // By then it has turned on the survivor; it is stood before them and they are made to look straight at it.
    tick(w, RETURN_TICKS - 1);
    expect(q.health).toBe(PLAYER_MAX_HEALTH);
    const look = lookAt(w, q, h);
    const kept = { x: h.pos.x, z: h.pos.z };
    tickWorld(w, new Map([[q.id, look]]));
    expect(p.health).toBe(PLAYER_MAX_HEALTH);
    expect(dist(h.pos, kept)).toBeLessThan(1);
    expect(h.targetId).toBe(q.id);
    const mine = pack(w).filter((e) => e.targetId === p.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.id).not.toBe(h.id);
    expect(pack(w)).toHaveLength(2);

    // Again, the survivor looking the other way: the killer is the one moved, and nothing new rises.
    tick(w, HOLD_TICKS + 1);
    const killer = mine[0]!;
    standAt(p, body.x - 90, body.z);
    kill(w, p, killer);
    // The survivor away again, their back to everything, and the first Hollow kept off them.
    standAt(q, body.x - 300, body.z);
    q.yaw += Math.PI;
    for (let i = 0; i < RETURN_TICKS; i++) {
      standAt(h, q.pos.x + 40, q.pos.z, ENEMY_HALF.y);
      tickWorld(w, new Map([[q.id, { seq: 2 + i, moveX: 0, moveZ: 0, yaw: q.yaw, pitch: 0, buttons: 0 }]]));
    }
    expect(q.health).toBe(PLAYER_MAX_HEALTH);
    expect(pack(w)).toHaveLength(2);
    expect(killer.ai).toBe(AiState.Emerge);
    expect(killer.targetId).toBe(p.id);
    expect(h.targetId).toBe(q.id);
  });

  it("never raises a Hollow past HOLLOW_PACK_MAX: at the cap the unseen one farthest from the survivors is taken", () => {
    const { w, ps, p, h, body } = chase(2);
    const q = ps[1]!;
    standAt(q, body.x - 300, body.z);
    standAt(p, body.x - 70, body.z);
    // The pack at its cap, all on the survivor, strung out behind them where they are not looking.
    const others: EnemyState[] = [];
    for (let i = 1; i < HOLLOW_PACK_MAX; i++) {
      const x = q.pos.x + 20 + i * 6;
      others.push(spawnHollow(w, { x, y: groundY(x, q.pos.z) + ENEMY_HALF.y, z: q.pos.z }, q.id, 600));
    }
    expect(pack(w)).toHaveLength(HOLLOW_PACK_MAX);
    kill(w, p, h);
    tick(w, RETURN_TICKS - 1);
    expect(q.health).toBe(PLAYER_MAX_HEALTH);
    tickWorld(w, new Map([[q.id, lookAt(w, q, h)]]));
    expect(p.health).toBe(PLAYER_MAX_HEALTH);
    expect(pack(w)).toHaveLength(HOLLOW_PACK_MAX);
    const farthest = others[others.length - 1]!;
    expect(farthest.targetId).toBe(p.id);
    expect(farthest.ai).toBe(AiState.Emerge);
  });

  it("stands a second returning player a step down the stem, not on the first", () => {
    const { w, ps, p, h, body } = chase(2);
    const q = ps[1]!;
    standAt(q, body.x - 300, body.z);
    kill(w, p, h);
    tick(w, RETURN_TICKS);
    expect(p.health).toBe(PLAYER_MAX_HEALTH);
    const first = { x: p.pos.x, z: p.pos.z };
    // The first kept standing there, untouched, while the second dies far off and comes back.
    p.heldFor = 100_000;
    kill(w, q, spawnHollow(w, { x: q.pos.x, y: q.pos.y, z: q.pos.z }, q.id, 0));
    tick(w, RETURN_TICKS);
    expect(q.health).toBe(PLAYER_MAX_HEALTH);
    expect(dist(p.pos, first)).toBeLessThan(3);
    expect(dist(q.pos, p.pos)).toBeGreaterThan(1);
    expect(dist(q.pos, first)).toBeLessThan(8);
  });

  it("drops the return of a player who left while dead", () => {
    const { w, ps, p, h, body } = chase(2);
    standAt(ps[1]!, body.x - 300, body.z);
    kill(w, p, h);
    tick(w, 10);
    removePlayer(w, p.id);
    expect(() => tick(w, RETURN_TICKS + 10)).not.toThrow();
    expect(w.state.players.has(p.id)).toBe(false);
    expect(ps[1]!.health).toBe(PLAYER_MAX_HEALTH);
  });

  it("does not pause the haunt's director for the Hollow that steps out at a return", () => {
    const { w, p, h } = chase();
    w.haunt!.active = true;
    kill(w, p, h);
    tick(w, RETURN_TICKS);
    expect(h.ai).toBe(AiState.Emerge);
    const rest = w.haunt!.rest;
    const episode = w.haunt!.episode;
    tick(w, 30);
    // The director's clock ran on: its rest counted down, or an episode began or went on.
    expect(w.haunt!.rest !== rest || w.haunt!.episode !== episode).toBe(true);
  });
});

describe("what the review found", SUITE, () => {
  it("kills nobody once the match is won: a player still on the trail stands through the end scene with a Hollow on them", () => {
    const { w, ps, p, h, body } = chase(2);
    const q = ps[1]!;
    const th = w.trail!.trailhead;
    standAt(q, body.x - 100, body.z);
    standAt(p, th.x, th.z);
    tick(w, 1);
    expect(w.state.outcome).toBe(Outcome.Won);
    // The Hollow on the one left on the trail, hunting them, for ten seconds of the scene.
    h.ai = AiState.Hunt; h.targetId = q.id;
    for (let i = 0; i < 600; i++) {
      h.pos = { x: q.pos.x + 0.3, y: q.pos.y - 0.9 + ENEMY_HALF.y, z: q.pos.z };
      tick(w, 1);
    }
    expect(q.health).toBe(PLAYER_MAX_HEALTH);
    // A lunge's blow, the same.
    const lunge = spawnShade(w, { x: q.pos.x + 1, y: q.pos.y, z: q.pos.z }, q, true, 10);
    lunge.ai = AiState.Strike; lunge.stateTimer = 0.9; lunge.attackCooldown = 0;
    tick(w, 60);
    expect(q.health).toBe(PLAYER_MAX_HEALTH);
  });

  it("in a party, moves the Hollow that killed them to the crest: the pack does not grow by a Hollow a death", () => {
    const { w, ps, p, h, body } = chase(2);
    const q = ps[1]!;
    standAt(q, body.x - 300, body.z);
    q.heldFor = 1_000_000;
    h.targetId = q.id;
    const at = { x: body.x - 120, y: groundY(body.x - 120, body.z) + ENEMY_HALF.y, z: body.z };
    const killer = spawnHollow(w, at, p.id, 0);
    standAt(p, body.x - 110, body.z);
    kill(w, p, killer);
    for (let i = 0; i < RETURN_TICKS; i++) { standAt(h, q.pos.x + 40, q.pos.z, ENEMY_HALF.y); tick(w, 1); }
    expect(p.health).toBe(PLAYER_MAX_HEALTH);
    // The killer is the one moved to the crest: no new Hollow rises for the return.
    expect(killer.targetId).toBe(p.id);
    expect(pack(w)).toHaveLength(2);
  });

  it("calls a Hollow seen that is anywhere in a survivor's frame, not only at its centre", () => {
    const { w, ps, p, h, body } = chase(2);
    const q = ps[1]!;
    standAt(q, body.x - 300, body.z);
    q.heldFor = 1_000_000;
    standAt(p, body.x - 70, body.z);
    kill(w, p, h);
    tick(w, RETURN_TICKS - 1);
    // Straight at it first (a clear line), then the look turned 34 degrees off: out of the stare's cone, well inside the frame.
    const look = lookAt(w, q, h);
    const off = { ...look, yaw: look.yaw + (34 * Math.PI) / 180 };
    q.yaw = off.yaw;
    expect(playerSees(q, h, w)).toBe(false);
    const kept = { x: h.pos.x, z: h.pos.z };
    tickWorld(w, new Map([[q.id, off]]));
    expect(p.health).toBe(PLAYER_MAX_HEALTH);
    expect(dist(h.pos, kept)).toBeLessThan(1);
    expect(pack(w)).toHaveLength(2);
  });
});

describe("where the returning player's Hollow steps out", SUITE, () => {
  it("is a place any peer can work out from the player's own: the host's Hollow stands on it, and a follower's world gives the same", () => {
    const { w, p, h } = chase();
    kill(w, p, h);
    tick(w, RETURN_TICKS);
    const at = returnHollowAt(w, p.pos)!;
    expect(dist(h.pos, at)).toBeLessThan(0.01);
    expect(h.pos.y).toBeCloseTo(at.y, 3);
    // A follower's world: built from the same seed, not authoritative, no enemies in it yet.
    const follower = createForestWorld(createForest(seed), false);
    const there = returnHollowAt(follower, p.pos)!;
    expect(dist(there, at)).toBeLessThan(0.001);
    expect(there.y).toBeCloseTo(at.y, 6);
  });
});

describe("where no checkpoint is", SUITE, () => {
  it("leaves a death on the hand-authored level permanent, and the match lost", () => {
    const FLOOR = { min: [-50, -1, -50] as [number, number, number], max: [50, 0, 50] as [number, number, number], material: "concrete" };
    const w = createWorld(parseLevel({ id: "flat", brushes: [FLOOR], playerSpawns: [[0, 0.9, 0]], enemySpawns: [] }), 1);
    const p = spawnPlayer(w);
    expect(returnsOn(w)).toBe(false);
    p.health = 0;
    for (let i = 0; i < RETURN_TICKS + 60; i++) tickWorld(w, new Map());
    expect(p.health).toBe(0);
    expect(w.state.outcome).toBe(Outcome.Lost);
  });

  it("is not on before the find, nor once the match is over", () => {
    const w = createForestWorld(createForest(seed));
    spawnPlayer(w);
    tickWorld(w, new Map());
    expect(returnsOn(w)).toBe(false);
    w.state.phase = Phase.Chase;
    expect(returnsOn(w)).toBe(true);
    w.state.outcome = Outcome.Won;
    expect(returnsOn(w)).toBe(false);
  });
});
