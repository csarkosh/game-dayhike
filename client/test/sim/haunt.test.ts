import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, serializeWorldState, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import type { World } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, elevationAt } from "../../src/sim/terrain.js";
import { AiState, Outcome, Phase } from "../../src/sim/types.js";
import type { EnemyState, PlayerState, Vec3 } from "../../src/sim/types.js";
import { ENEMY_HALF, PLAYER_EYE_OFFSET, TICK_DT } from "../../src/sim/constants.js";
import type { TrailNode } from "../../src/sim/trail.js";
import { stemAhead, stemNodes } from "../../src/sim/trailRoute.js";
import { isOnCorridor, roadOffset } from "../../src/sim/containment.js";
import { hasLineOfSight } from "../../src/sim/ai.js";
import { climbOf } from "../../src/sim/watcher.js";
import { MIST_AT, MIST_SPAN, actsUnder, DUSK_AT, NIGHT_SPAN } from "../../src/sim/acts.js";
import {
  GUIDE_REACH, HAUNT_MIST_MIN, HAUNT_PRESS_SPAN, HAUNT_REAL_CHASE, HAUNT_REAL_CLIMB, HAUNT_REST_EARLY, HAUNT_REST_LATE, HAUNT_SHADES_EARLY, HAUNT_SHADES_LATE, LUNGE_ATTACK_M, LUNGE_ATTACK_S, LUNGE_MAX_S,
  LUNGE_RANGE, SHADE_BEARING_MAX_COS, SHADE_BEARING_MIN_COS, SHADE_DWELL_S, SHADE_FLEE_RADIUS, SHADE_RANGE, SHADE_WATCHED_S, OFF_TRAIL_FROM_M, OFF_TRAIL_SPAN_M, OFF_TRAIL_REAL_EACH, offTrailOf,
  bestClimb, isHaunting, isShadeState, placeShadeOnGuide, pressureOf, spawnShade, startPursuit, PURSUIT_STOP_U,
  PURSUIT_AHEAD_M, PURSUIT_IN_M, PURSUIT_VERGE_U, pursuitAim,
} from "../../src/sim/haunt.js";
import { isHollow, SHADE_STARE_CAP, SUMMIT_REVEAL_S, spawnHollow } from "../../src/sim/hollow.js";
import { trailDistance } from "../../src/sim/trail.js";
import { stepSummit, updateSafety } from "../../src/sim/summit.js";
import { CAR_HALF, carDirection, doorSpot } from "../../src/sim/trailhead.js";
import { carDistance, laneAt } from "../../src/game/endScene.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);
const seed = seedFromToken("hollow");

function forestWorld() {
  const w = createForestWorld(createForest(seed));
  w.watcher!.active = false;
  const p = spawnPlayer(w);
  return { w, p };
}
const node = (w: World, i: number) => w.trail!.nodes[i] as TrailNode;
const standAt = (p: PlayerState, x: number, z: number) => { p.pos = { x, y: elevationAt(seed, x, z) + 0.9, z }; };
/** Stands a player on the first stem node whose climb is at least `climb`, facing the next node up. */
function standAtClimb(w: World, p: PlayerState, climb: number): void {
  const chain = stemNodes(w.trail!);
  for (let i = 0; i + 1 < chain.length; i++) {
    const here = node(w, chain[i] as number);
    if (climbOf(w.trail!, here.x, here.z) < climb) continue;
    const next = node(w, chain[i + 1] as number);
    standAt(p, here.x, here.z);
    p.yaw = Math.atan2(next.x - here.x, next.z - here.z);
    p.pitch = 0;
    return;
  }
  throw new Error(`no stem node at climb ${climb}`);
}
const tick = (w: World, n = 1) => { for (let i = 0; i < n; i++) tickWorld(w, new Map()); };
const shades = (w: World): EnemyState[] => [...w.state.enemies.values()].filter((e) => isShadeState(e.ai));
function lookAt(p: PlayerState, at: Vec3) {
  const dx = at.x - p.pos.x, dz = at.z - p.pos.z, dy = at.y - (p.pos.y + PLAYER_EYE_OFFSET);
  p.yaw = Math.atan2(dx, dz);
  p.pitch = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
}
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
/** The night's threshold, as a climb. */
const NIGHT_CLIMB = MIST_AT + MIST_SPAN + 0.02;

describe("the director", () => {
  it("is made for every authoritative forest world, active, with its first rest drawn, and runs nothing by day", () => {
    const { w, p } = forestWorld();
    expect(w.haunt).not.toBeNull();
    expect(w.haunt!.active).toBe(true);
    expect(w.haunt!.rest).toBeGreaterThanOrEqual(HAUNT_REST_EARLY[0]);
    expect(w.haunt!.rest).toBeLessThanOrEqual(HAUNT_REST_EARLY[1]);
    standAtClimb(w, p, 0.2);
    expect(isHaunting(w)).toBe(false);
    const rest = w.haunt!.rest;
    tick(w, 300);
    expect(w.haunt!.rest).toBe(rest);
    expect(w.state.enemies.size).toBe(0);
    expect(createForestWorld(createForest(seed), false).haunt).toBeNull();
    // Two world builds, each slower since the valley lakes: together past
    // vitest's 5 s default.
  }, timeLimit(30_000));

  it("haunts once the mist is whole on the ground, after the night, by the best living climb, and through the chase, pressing harder toward the crest", () => {
    const { w, p } = forestWorld();
    standAtClimb(w, p, DUSK_AT + NIGHT_SPAN + 0.02);
    expect(actsUnder(bestClimb(w)).night).toBeGreaterThan(0.95);
    expect(isHaunting(w)).toBe(false);
    standAtClimb(w, p, MIST_AT + MIST_SPAN * 0.5);
    expect(isHaunting(w)).toBe(false);
    standAtClimb(w, p, NIGHT_CLIMB);
    expect(actsUnder(bestClimb(w)).mist).toBeGreaterThanOrEqual(HAUNT_MIST_MIN);
    expect(isHaunting(w)).toBe(true);
    expect(pressureOf(w)).toBeLessThan(0.1);
    // Full pressure well before the crest: HAUNT_PRESS_SPAN of the climb past full night.
    standAtClimb(w, p, MIST_AT + MIST_SPAN + HAUNT_PRESS_SPAN + 0.02);
    expect(pressureOf(w)).toBe(1);
    expect(HAUNT_REAL_CHASE).toBeGreaterThan(HAUNT_REAL_CLIMB);
    expect(HAUNT_REST_LATE[1]).toBeLessThan(HAUNT_REST_EARLY[0]);
    expect(HAUNT_SHADES_LATE[0]).toBeGreaterThan(HAUNT_SHADES_EARLY[1]);
    p.health = 0;
    expect(bestClimb(w)).toBe(0);
    expect(isHaunting(w)).toBe(false);
    w.state.phase = Phase.Chase;
    expect(isHaunting(w)).toBe(true);
    expect(pressureOf(w)).toBe(1);
  });

  it("stands shades up at night, each at the edge of its player's sight: in range, in a clear sightline, off the corridor, facing them, and harmless", () => {
    const { w, p } = forestWorld();
    standAtClimb(w, p, NIGHT_CLIMB);
    w.haunt!.rest = 0;
    let first: EnemyState | undefined;
    for (let i = 0; i < 600 && first === undefined; i++) {
      tick(w);
      first = shades(w)[0];
    }
    expect(first).toBeDefined();
    const h = first!;
    expect(h.ai).toBe(AiState.Shade);
    expect(isHollow(h)).toBe(false);
    expect(h.targetId).toBe(p.id);
    const d = dist(h.pos, p.pos);
    expect(d).toBeGreaterThanOrEqual(SHADE_RANGE[0] - 1e-6);
    expect(d).toBeLessThanOrEqual(SHADE_RANGE[1] + 1e-6);
    expect(isOnCorridor(w, h.pos.x, h.pos.z)).toBe(false);
    expect(hasLineOfSight({ x: p.pos.x, y: p.pos.y + PLAYER_EYE_OFFSET, z: p.pos.z }, h.pos, w.boxes, w.ground)).toBe(true);
    expect(h.yaw).toBeCloseTo(Math.atan2(p.pos.x - h.pos.x, p.pos.z - h.pos.z), 6);
    // In the band off the look: 10° to 32°, inside the headlamp.
    const bx = h.pos.x - p.pos.x, bz = h.pos.z - p.pos.z;
    const cos = (bx * Math.sin(p.yaw) + bz * Math.cos(p.yaw)) / d;
    expect(cos).toBeGreaterThanOrEqual(SHADE_BEARING_MAX_COS - 1e-3);
    expect(cos).toBeLessThanOrEqual(SHADE_BEARING_MIN_COS + 1e-3);
    expect(h.stateTimer).toBeGreaterThan(SHADE_DWELL_S[0] - TICK_DT * 2);
    // The episode goes on: more of them, and the count is the episode's.
    expect(w.haunt!.episode).not.toBeNull();
    expect(w.haunt!.episode!.shades).toBeLessThanOrEqual(HAUNT_SHADES_LATE[1] - 1);
    // It stands where it rose and stares, never a step; harmless, it costs nothing but its presence.
    const before = dist(h.pos, p.pos);
    tick(w, 60);
    expect(dist(h.pos, p.pos)).toBeCloseTo(before, 6);
    expect(Math.abs(h.yaw - Math.atan2(p.pos.x - h.pos.x, p.pos.z - h.pos.z))).toBeLessThan(0.05);
    expect(p.health).toBe(100);
  });

  it("a shade is gone when a player comes within SHADE_FLEE_RADIUS, or has looked at it SHADE_WATCHED_S, or its time is up", () => {
    const { w, p } = forestWorld();
    standAtClimb(w, p, NIGHT_CLIMB);
    const ahead = { x: p.pos.x + Math.sin(p.yaw) * 16, y: 0, z: p.pos.z + Math.cos(p.yaw) * 16 };
    ahead.y = elevationAt(seed, ahead.x, ahead.z) + 1;
    // Neared.
    let h = spawnShade(w, ahead, p, false, 20);
    standAt(p, h.pos.x + SHADE_FLEE_RADIUS - 1, h.pos.z);
    p.yaw += Math.PI;
    tick(w);
    expect(w.state.enemies.has(h.id)).toBe(false);
    // Watched: present up to the second, gone after it.
    standAtClimb(w, p, NIGHT_CLIMB);
    h = spawnShade(w, ahead, p, false, 20);
    lookAt(p, h.pos);
    const watch = Math.round(SHADE_WATCHED_S / TICK_DT);
    tick(w, watch - 1);
    expect(w.state.enemies.has(h.id)).toBe(true);
    tick(w, 2);
    expect(w.state.enemies.has(h.id)).toBe(false);
    // Timed out, unlooked at.
    h = spawnShade(w, ahead, p, false, 0.5);
    p.yaw += Math.PI;
    tick(w, 31);
    expect(w.state.enemies.has(h.id)).toBe(false);
  });

  it("a lunge comes at its player, strikes at arm's length, and kills; a player who steps out of its line sees it pass and go", () => {
    const { w, p } = forestWorld();
    w.haunt!.active = false;
    standAtClimb(w, p, 0.3);
    const from = { x: p.pos.x + Math.sin(p.yaw) * 22, y: 0, z: p.pos.z + Math.cos(p.yaw) * 22 };
    from.y = elevationAt(seed, from.x, from.z) + 1;
    const h = spawnShade(w, from, p, true, 0);
    expect(h.ai).toBe(AiState.Lunge);
    expect(isHollow(h)).toBe(true);
    expect(h.stateTimer).toBe(LUNGE_MAX_S);
    w.haunt!.active = true;
    const start = dist(h.pos, p.pos);
    tick(w, 60);
    expect(w.state.enemies.has(h.id)).toBe(true);
    expect(dist(h.pos, p.pos)).toBeLessThan(start - 4);
    // Standing still: it comes to arm's length, strikes, and they are dead before the strike is over; then it is gone.
    let struck = -1, touched = -1, gone = -1;
    for (let t = 0; t < 400 && gone < 0; t++) {
      tick(w);
      if (struck < 0 && h.ai === AiState.Strike) { struck = t; expect(dist(h.pos, p.pos)).toBeLessThanOrEqual(LUNGE_ATTACK_M + 0.5); }
      if (touched < 0 && p.health <= 0) touched = t;
      if (!w.state.enemies.has(h.id)) gone = t;
    }
    expect(struck).toBeGreaterThanOrEqual(0);
    expect(touched).toBeGreaterThanOrEqual(struck);
    expect(gone).toBeGreaterThan(struck);
    expect((gone - struck) * TICK_DT).toBeLessThanOrEqual(LUNGE_ATTACK_S + 0.05);

    // Again, and this time they step out of its line: it passes, and is gone, and they live.
    const { w: w2, p: q } = forestWorld();
    standAtClimb(w2, q, 0.3);
    const from2 = { x: q.pos.x + Math.sin(q.yaw) * 22, y: 0, z: q.pos.z + Math.cos(q.yaw) * 22 };
    from2.y = elevationAt(seed, from2.x, from2.z) + 1;
    const l = spawnShade(w2, from2, q, true, 0);
    tick(w2, 30);
    // Six metres across the line, more than the drift can follow.
    standAt(q, q.pos.x + Math.cos(q.yaw) * 6, q.pos.z - Math.sin(q.yaw) * 6);
    let passed = -1;
    for (let t = 0; t < Math.round(LUNGE_MAX_S / TICK_DT) + 10 && passed < 0; t++) {
      tick(w2);
      if (!w2.state.enemies.has(l.id)) passed = t;
    }
    expect(passed).toBeGreaterThanOrEqual(0);
    expect(q.health).toBe(100);
    expect(LUNGE_RANGE[0]).toBeGreaterThan(SHADE_FLEE_RADIUS);
  });

  it("a shade in the stare's cone closes the dark a little, to SHADE_STARE_CAP and no further, on the climb as in the chase", () => {
    const { w, p } = forestWorld();
    standAtClimb(w, p, 0.3);
    const ahead = { x: p.pos.x + Math.sin(p.yaw) * 14, y: 0, z: p.pos.z + Math.cos(p.yaw) * 14 };
    ahead.y = elevationAt(seed, ahead.x, ahead.z) + 1;
    w.haunt!.active = false;
    const h = spawnShade(w, ahead, p, false, 60);
    // Held still, and never watched out: the test turns the shade's own timers off.
    const hold = () => { h.pos = { ...ahead }; h.stateTimer = 60; h.attackCooldown = 0; };
    lookAt(p, h.pos);
    for (let t = 0; t < 600; t++) { hold(); tick(w); }
    expect(p.stare).toBeCloseTo(SHADE_STARE_CAP, 6);
    expect(p.health).toBe(100);
    w.state.phase = Phase.Chase;
    for (let t = 0; t < 120; t++) { hold(); tick(w); }
    expect(p.stare).toBeCloseTo(SHADE_STARE_CAP, 6);
    p.yaw += Math.PI;
    tick(w, 60);
    expect(p.stare).toBeLessThan(SHADE_STARE_CAP);
  });

  it("in the chase, off the trail, the haunt answers: more shades an episode, and each more likely the real thing", () => {
    const { w, p } = forestWorld();
    standAtClimb(w, p, 0.9);
    w.state.phase = Phase.Chase;
    expect(offTrailOf(w)).toBe(0);
    // Step off the trail, far: the measure fills to 1.
    const graph = w.trail!;
    const here = { x: p.pos.x, z: p.pos.z };
    let off = 0;
    for (let step = 1; step <= 60 && off < 1; step++) {
      standAt(p, here.x + step, here.z);
      off = offTrailOf(w);
    }
    expect(off).toBe(1);
    expect(trailDistance(graph, p.pos.x, p.pos.z)).toBeGreaterThanOrEqual(OFF_TRAIL_FROM_M + OFF_TRAIL_SPAN_M);
    // Over many episodes off the trail, the lunges outnumber the shades by far; on it, the real one is at most one an episode.
    const count = (offTrail: boolean) => {
      const { w: w2, p: p2 } = forestWorld();
      standAtClimb(w2, p2, 0.9);
      w2.state.phase = Phase.Chase;
      w2.haunt!.rest = 0;
      if (offTrail) for (let step = 1; step <= 60 && offTrailOf(w2) < 1; step++) standAt(p2, p2.pos.x + 1, p2.pos.z);
      let lunges = 0, shades = 0;
      for (let t = 0; t < 9000; t++) {
        tick(w2);
        p2.health = 100;
        for (const [id, e] of w2.state.enemies) {
          if (e.ai === AiState.Lunge || e.ai === AiState.Strike) lunges++;
          else if (e.ai === AiState.Shade) shades++;
          w2.state.enemies.delete(id);
        }
      }
      return { lunges, shades };
    };
    const on = count(false), away = count(true);
    expect(away.lunges + away.shades).toBeGreaterThan((on.lunges + on.shades) * 1.5);
    expect(away.lunges / Math.max(1, away.lunges + away.shades)).toBeGreaterThan(0.8);
    expect(on.lunges / Math.max(1, on.lunges + on.shades)).toBeLessThan(0.5);
    expect(OFF_TRAIL_REAL_EACH).toBeLessThan(0.3);
  });

  it("waits while a Hollow is stepping out: no episode begins during the summit's reveal", () => {
    const { w, p } = forestWorld();
    standAtClimb(w, p, 0.9);
    w.state.phase = Phase.Chase;
    w.haunt!.rest = 0;
    const summit = spawnHollow(w, { x: p.pos.x + 30, y: p.pos.y, z: p.pos.z }, p.id, SUMMIT_REVEAL_S);
    for (let t = 0; t < Math.round((SUMMIT_REVEAL_S - 0.5) / TICK_DT); t++) tick(w);
    expect(summit.ai).toBe(AiState.Emerge);
    expect(w.haunt!.episode).toBeNull();
    expect([...w.state.enemies.values()].filter((e) => e.ai === AiState.Shade || e.ai === AiState.Lunge)).toHaveLength(0);
    for (let t = 0; t < Math.round(3 / TICK_DT); t++) { tick(w); p.health = 100; }
    expect(summit.ai).not.toBe(AiState.Emerge);
    expect(w.haunt!.episode !== null || [...w.state.enemies.values()].some((e) => e.ai === AiState.Shade || e.ai === AiState.Lunge)).toBe(true);
  });

  it("in the chase, a shade stands beside the open way home, ahead of its player and nearer the pad", () => {
    const { w, p } = forestWorld();
    const graph = w.trail!;
    const chain = stemNodes(graph);
    // A player a way up the stem, looking down it, with the stem as the guide (crest to pad).
    const at = chain.indexOf(chain[Math.floor(chain.length * 0.6)] as number);
    const here = node(w, chain[at] as number), down = node(w, chain[at - 1] as number);
    standAt(p, here.x, here.z);
    p.yaw = Math.atan2(down.x - here.x, down.z - here.z);
    w.state.phase = Phase.Chase;
    w.cut = { guide: [...chain].reverse(), cuts: new Map(), closed: new Set() };
    const rng = { rngSeed: 7 };
    let placed: Vec3 | null = null;
    for (let i = 0; i < 20 && placed === null; i++) placed = placeShadeOnGuide(w, p, rng);
    expect(placed).not.toBeNull();
    const d = dist(placed!, p.pos);
    expect(d).toBeLessThanOrEqual(GUIDE_REACH[1]);
    expect(d).toBeGreaterThan(3);
    // Ahead: within the wide view of the look down the stem.
    const dx = placed!.x - p.pos.x, dz = placed!.z - p.pos.z;
    expect((dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / d).toBeGreaterThan(0.17);
    // Nearer the next node down the way home than the player is.
    expect(dist(placed!, { x: down.x, y: 0, z: down.z })).toBeLessThan(dist(p.pos, { x: down.x, y: 0, z: down.z }));
    // Looking back up the stem, no guide node is ahead: null, and the band placement stands in.
    p.yaw += Math.PI;
    expect(placeShadeOnGuide(w, p, rng)).toBeNull();
  });
});

describe("the pursuit", () => {
  /** A won match: the chase on, the one player on the pad, one tick. */
  function won() {
    const { w, p } = forestWorld();
    w.state.phase = Phase.Chase;
    const th = w.trail!.trailhead;
    standAt(p, th.x, th.z);
    tick(w);
    return { w, p };
  }
  /** A win made on the stem: up it until outside the corridor, then down it a tenth of a metre a tick until the win. */
  function stemWin() {
    const { w, p } = forestWorld();
    w.state.phase = Phase.Chase;
    const graph = w.trail!;
    const roadU = (x: number, z: number) => roadOffset(w, x, z) as number;
    let at = { x: graph.trailhead.x, z: graph.trailhead.z };
    while (roadU(at.x, at.z) < 31) at = stemAhead(graph, at.x, at.z, 1)!;
    standAt(p, at.x, at.z);
    let steps = 0;
    while (w.state.outcome === Outcome.Playing && steps < 400) {
      at = stemAhead(graph, p.pos.x, p.pos.z, -0.1)!;
      standAt(p, at.x, at.z);
      tick(w);
      steps++;
    }
    expect(w.state.outcome).toBe(Outcome.Won);
    return { w, p };
  }
  const pursuers = (w: World): EnemyState[] => [...w.state.enemies.values()].filter((e) => e.ai === AiState.Pursue);
  const u = (w: World, e: EnemyState) => roadOffset(w, e.pos.x, e.pos.z) as number;
  const doorOf = (w: World) => doorSpot(w.search!.car, carDirection(w.search!.car, w.trail!.trailhead));
  const facing = (h: EnemyState, at: Vec3) => Math.atan2(at.x - h.pos.x, at.z - h.pos.z);

  it("with every winner on the pad, stands one shade of the end up on the winning tick at the trail's entrance, once", () => {
    const { w, p } = won();
    expect(w.state.outcome).toBe(Outcome.Won);
    const one = pursuers(w);
    // 2026-10-13: ids 2 to 5 before one shade; the first of them stood where this one does.
    expect(one.map((e) => e.id)).toEqual([2]);
    const h = one[0]!;
    expect(h.pos.x).toBeCloseTo(-305.7794721388503, 6);
    expect(h.pos.y).toBeCloseTo(4.058108456105842, 6);
    expect(h.pos.z).toBeCloseTo(0.9167297835065525, 6);
    expect(h.targetId).toBe(p.id);
    expect(h.stateTimer).toBe(25);
    // No stop of its own: it walks at its player. It keeps the car's door spot, inland of the car
    // and half a metre ahead of its centre (the car faces +z here).
    // 2026-10-13: null before the door was kept in it.
    expect(h.emergeTo!.x).toBeCloseTo(-314.32677397683483, 9);
    expect(h.emergeTo!.z).toBe(0.5);
    expect(h.attackCooldown).toBe(0);
    expect(isShadeState(h.ai)).toBe(true);
    expect(isHollow(h)).toBe(false);
    // Never a second time: the match is over and the end rule judges nothing more.
    tick(w, 120);
    expect(pursuers(w).map((e) => e.id)).toEqual([2]);
    // 2026-10-13: 6 before one shade.
    expect(w.state.nextEntityId).toBe(3);
  });

  it("in a win made on the stem, at the corridor's edge, rises 3 m behind the winner, further from the car", () => {
    const { w, p } = stemWin();
    const car = w.search!.car;
    // The win, a hand's breadth inside the corridor's 30 m, 22.99 m from the car and 21.45 m from its door.
    expect(roadOffset(w, p.pos.x, p.pos.z)).toBeCloseTo(29.955935177077265, 6);
    expect(dist(p.pos, car)).toBeCloseTo(22.987426333046642, 6);
    const door = doorOf(w);
    expect(dist(p.pos, { x: door.x, y: 0, z: door.z })).toBeCloseTo(21.446207932933838, 6);
    const one = pursuers(w);
    expect(one).toHaveLength(1);
    const h = one[0]!;
    expect(h.pos.x).toBeCloseTo(-289.98420973585695, 6);
    expect(h.pos.y).toBeCloseTo(6.98788189907859, 6);
    expect(h.pos.z).toBeCloseTo(2.7387302282257253, 6);
    expect(dist(h.pos, p.pos)).toBeCloseTo(3, 9);
    expect(dist(h.pos, car)).toBeCloseTo(25.987280923791662, 6);
    expect(dist(h.pos, car)).toBeGreaterThan(dist(p.pos, car));
    expect(h.targetId).toBe(p.id);
    // 2026-10-13: null before the door was kept in it.
    expect(h.emergeTo!.x).toBeCloseTo(door.x, 9);
    expect(h.emergeTo!.z).toBe(door.z);
  });

  it("walks straight at its player at 5.5 m/s as they run for the door, never nearer the road than 7.9 m, and stands within a metre of them, facing them", () => {
    const { w, p } = stemWin();
    const h = pursuers(w)[0]!;
    const door = doorOf(w);
    // The player runs for the door at a sprint's 7 m/s, faster than the shade.
    const run = () => {
      const dx = door.x - p.pos.x, dz = door.z - p.pos.z, d = Math.hypot(dx, dz);
      const step = Math.min(d, 7 * TICK_DT);
      if (d > 0) standAt(p, p.pos.x + (dx / d) * step, p.pos.z + (dz / d) * step);
    };
    let reached = -1;
    let inCar = -1;
    let nearest = Infinity;
    for (let t = 1; t <= 332; t++) {
      run();
      tick(w);
      if (t === 120) expect(Math.hypot(h.vel.x, h.vel.z)).toBeCloseTo(5.5, 6);
      if (inCar < 0 && h.attackCooldown > 0) inCar = t;
      if (reached < 0 && dist(h.pos, p.pos) <= 1) reached = t;
      if (u(w, h) < nearest) nearest = u(w, h);
    }
    // The player within 0.9 m of the door 177 ticks after the win, its clock running from then;
    // the shade within a metre of them at the door at 260 (4.33 s).
    expect(inCar).toBe(177);
    expect(reached).toBe(260);
    // On foot, never on the pavement (5.5 m) nor past the stop at 7.9 m from the centreline.
    expect(nearest).toBeCloseTo(9.394193750236184, 6);
    expect(nearest).toBeGreaterThanOrEqual(7.9);
    // Standing at its player through the car's 2.6 s at the door, facing them.
    expect(h.pos.x).toBeCloseTo(-313.379818726, 6);
    expect(h.pos.z).toBeCloseTo(0.58424307, 6);
    expect(dist(h.pos, p.pos)).toBeLessThanOrEqual(1);
    expect(h.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(h.yaw).toBeCloseTo(facing(h, p.pos), 9);
  });

  it("once its player is in the car and the car has pulled away, runs down the verge after it at 5.5 m/s, in behind it by one in ten and never across its nose, until it is gone after 25 s", () => {
    const { w, p } = won();
    const h = pursuers(w)[0]!;
    const car = w.search!.car;
    const door = doorOf(w);
    standAt(p, door.x, door.z);
    // Its player in the car from its first tick: it walks to them and stands, facing them, until
    // the pull-away (156 ticks is 2.6 s; the clock's sum is a hair short of it at the 156th).
    tick(w, 156);
    expect(h.attackCooldown).toBeCloseTo(2.6, 9);
    expect(h.pos.x).toBeCloseTo(-313.40701828305635, 6);
    expect(h.pos.z).toBeCloseTo(0.5448433433629293, 6);
    expect(dist(h.pos, p.pos)).toBeLessThanOrEqual(1);
    expect(h.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(h.yaw).toBeCloseTo(facing(h, p.pos), 9);
    // The car gone, it takes the road: at the 157th tick it moves, the way the car went (+z here).
    tick(w);
    expect(h.vel.z).toBeGreaterThan(0);
    expect(u(w, h)).toBeCloseTo(9.36230979486487, 6);
    // 2026-10-13: z 0.5555553361622887 before the verge, its aim then the centreline itself.
    expect(h.pos.z).toBeCloseTo(0.5598780505450305, 6);
    // The car as the scene drives it (game/endScene.ts), on the shade's own clock: its centre
    // carDistance along the road, its lane eased from the shoulder's 6.9 m in to 1.8 m. Beside it
    // the shade is never within 0.9 m of its inland side (its stand by the door, the car just
    // rolling), and the car's tail is past it at the 367th tick (6.1 s after the arrival).
    const parked = roadOffset(w, car.x, car.z) as number;
    let nearest = Infinity;
    let passed = -1;
    const at: Record<number, number> = {};
    let stop = -1;
    let bed = -1;
    for (let t = 158; t <= 900; t++) {
      tick(w);
      const along = carDistance(h.attackCooldown);
      const carZ = car.z + along;
      if (h.pos.z + ENEMY_HALF.z > carZ - CAR_HALF.z && h.pos.z - ENEMY_HALF.z < carZ + CAR_HALF.z) {
        const gap = u(w, h) - ENEMY_HALF.x - (laneAt(along, parked) + CAR_HALF.x);
        if (gap < nearest) nearest = gap;
      }
      if (passed < 0 && carZ - CAR_HALF.z > h.pos.z) passed = t;
      if (t === 330) {
        // The road shot's first frame, 5.5 s after the arrival: level with the car (1.19 m
        // ahead of its centre), on the verge 2.1 m off its inland side.
        expect(h.pos.z).toBeCloseTo(15.91115869217794, 6);
        expect(u(w, h)).toBeCloseTo(7.839095320843853, 6);
        expect(h.pos.z - carZ).toBeCloseTo(1.1936586921780847, 6);
      }
      for (const m of [10, 30, 35]) if (at[m] === undefined && h.pos.z - door.z >= m) at[m] = u(w, h);
      if (stop < 0 && u(w, h) < PURSUIT_STOP_U) stop = t;
      if (bed < 0 && u(w, h) < 5.5) bed = t;
    }
    expect(nearest).toBeCloseTo(0.9050965299867553, 6);
    expect(passed).toBe(367);
    // Down the verge at one in ten: 8.37 m from the centreline 10 m down the road, 6.40 m at
    // 30 m, 5.91 m at 35 m; past the stop's 7.9 m at the 324th tick, on the road's 5.5 m bed at
    // the 595th (39 m down it, the car 35 m ahead of it).
    // 2026-10-13: past the stop at the 206th before the verge.
    expect(at[10]).toBeCloseTo(8.365686914658568, 6);
    expect(at[10]).toBeGreaterThanOrEqual(7.4);
    expect(at[30]).toBeCloseTo(6.40078991700608, 6);
    expect(at[35]).toBeCloseTo(5.914671154833911, 6);
    expect(stop).toBe(324);
    expect(bed).toBe(595);
    // Down the road, its z 5.44 m a second (the rest of its 5.5 across, as it comes in).
    // 2026-10-13: 5.4929031092147085 before the verge.
    const from = { ...h.pos };
    tick(w, 60);
    expect(h.pos.z - from.z).toBeCloseTo(5.443069320023525, 6);
    expect(u(w, h)).toBeCloseTo(2.2889036141081647, 6);
    // It faces its aim.
    const was = { ...h.pos };
    const aim = pursuitAim(u(w, h), was.z, 1, (_, z) => was.x - (roadOffset(w, was.x, z) as number), 0, { x: 0, z: 0 });
    tick(w);
    expect(h.yaw).toBe(Math.atan2(aim.x - was.x, aim.z - was.z));
    tick(w, 1499 - 961);
    expect(w.state.enemies.has(h.id)).toBe(true);
    // 122 m down the road, 6 cm off its centreline.
    // 2026-10-13: z 120.21336590619525 and 0.042643650708669156 before the verge.
    expect(h.pos.z).toBeCloseTo(122.1346459428561, 6);
    expect(u(w, h)).toBeCloseTo(0.0634097650714125, 6);
    tick(w, 2);
    expect(pursuers(w)).toHaveLength(0);
  }, timeLimit(30_000));

  it("with its player never at the door, takes the road 10 s and 2.6 s after it rose, the run's time up regardless, making for the verge first", () => {
    const { w, p } = stemWin();
    const h = pursuers(w)[0]!;
    let reached = -1;
    for (let t = 1; t <= 756; t++) {
      tick(w);
      if (reached < 0 && dist(h.pos, p.pos) <= 1) reached = t;
      // The run's time up at 10 s: at the 600th the timer's sum leaves a hair short of 10 s gone,
      // so the clock starts at the 601st.
      if (t === 600) expect(h.attackCooldown).toBe(0);
      if (t === 601) expect(h.attackCooldown).toBeGreaterThan(0);
    }
    expect(reached).toBe(26);
    // It stood at its player throughout, facing them.
    expect(h.pos.x).toBeCloseTo(-292.01567905447877, 6);
    expect(h.pos.z).toBeCloseTo(2.504398065357618, 6);
    expect(h.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(h.yaw).toBeCloseTo(facing(h, p.pos), 9);
    // At the 757th it takes the road, though its player is 30 m from it: its aim no further out
    // than the verge's 8.4 m, so it makes for the verge before it comes in.
    // 2026-10-13: (-292.03024977187624, 2.508992049287656), and 19.29 m at the 900th,
    // before the verge.
    tick(w);
    expect(h.pos.x).toBeCloseTo(-292.02972001696884, 6);
    expect(h.pos.z).toBeCloseTo(2.5104198479989988, 6);
    tick(w, 143);
    expect(u(w, h)).toBeCloseTo(20.21707477863896, 6);
    let road = -1;
    for (let t = 901; t < 1499 && road < 0; t++) {
      tick(w);
      if (u(w, h) < PURSUIT_STOP_U) road = t;
    }
    // 2026-10-13: 1063 before the verge.
    expect(road).toBe(1351);
  }, timeLimit(30_000));

  it("with its player gone from the match, stands, and still takes the road when the run's time is up", () => {
    const { w, p } = stemWin();
    const h = pursuers(w)[0]!;
    tick(w, 30);
    w.state.players.delete(p.id);
    const stood = { ...h.pos };
    // To the 630th: stood where it was, its clock running from the 601st.
    tick(w, 600);
    expect(h.pos).toEqual(stood);
    expect(h.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(h.attackCooldown).toBeCloseTo(0.5, 9);
    // Past the pull-away at the 757th, on its way to the verge.
    tick(w, 200);
    expect(h.pos.z).toBeCloseTo(5.286828560095377, 6);
    expect(u(w, h)).toBeCloseTo(25.327465204959367, 6);
  }, timeLimit(30_000));

  it("aims down the road PURSUIT_AHEAD_M ahead the way the car went, PURSUIT_IN_M in from its own offset, never past the centreline nor further out than the verge", () => {
    // A road whose centreline is at x = 2 + z / 10.
    const centre = (_: number, z: number) => 2 + z / 10;
    const out = { x: 0, z: 0 };
    expect(PURSUIT_AHEAD_M).toBe(10);
    expect(PURSUIT_IN_M).toBe(1);
    expect(PURSUIT_VERGE_U).toBeCloseTo(8.4, 12);
    // +z, inland (+u): 10 m on, 1 m in.
    expect(pursuitAim(8.4, 0, 1, centre, 0, out)).toBe(out);
    expect(out.z).toBe(10);
    expect(out.x).toBeCloseTo(3 + 7.4, 12);
    // −z, across the road (−u): 10 m back along z, 1 m in toward the centreline.
    pursuitAim(-3, 5, -1, centre, 0, out);
    expect(out.z).toBe(-5);
    expect(out.x).toBeCloseTo(1.5 - 2, 12);
    // Within a metre of the centreline, either side, the centreline itself.
    pursuitAim(0.6, 20, 1, centre, 0, out);
    expect(out).toEqual({ x: 5, z: 30 });
    pursuitAim(-0.6, 20, -1, centre, 0, out);
    expect(out).toEqual({ x: 3, z: 10 });
    // From the woods, 30 m out, the verge's 8.4 m; −u likewise, on the far side.
    pursuitAim(30, 0, -1, centre, 0, out);
    expect(out.z).toBe(-10);
    expect(out.x).toBeCloseTo(1 + 8.4, 12);
    pursuitAim(-30, 0, 1, centre, 0, out);
    expect(out.x).toBeCloseTo(3 - 8.4, 12);
  });

  it("one that starts nearer the road than the stop may still step away from it", () => {
    const { w, p } = won();
    const h = pursuers(w)[0]!;
    // 7 m from the centreline, 10 m along the road from the car; its player inland, 20 m from it.
    const roadX = 0 - (roadOffset(w, 0, 10) as number);
    h.pos = { x: roadX + 7, y: elevationAt(seed, roadX + 7, 10) + 0.9, z: 10 };
    standAt(p, roadX + 20, 10);
    tick(w, 60);
    expect(u(w, h)).toBeGreaterThan(12);
  });

  it("stands none up when the party dies, and only on the win the end rule itself sets", () => {
    // Everyone dead: the loss is judged before the end rule, which then judges nothing.
    const { w, p } = forestWorld();
    w.state.phase = Phase.Chase;
    p.health = 0;
    tick(w);
    expect(w.state.outcome).toBe(Outcome.Lost);
    tick(w, 60);
    expect(pursuers(w)).toHaveLength(0);
    // A match already over, lost or won, stands nothing up through the end rule.
    // Each with its player safe on the pad, as a win would have it: only the guard stops the rule.
    const lost = forestWorld();
    lost.w.state.phase = Phase.Chase;
    standAt(lost.p, lost.w.trail!.trailhead.x, lost.w.trail!.trailhead.z);
    updateSafety(lost.w);
    expect(lost.p.safe).toBe(true);
    lost.w.state.outcome = Outcome.Lost;
    stepSummit(lost.w);
    expect(lost.w.state.outcome).toBe(Outcome.Lost);
    expect(pursuers(lost.w)).toHaveLength(0);
    const over = forestWorld();
    over.w.state.phase = Phase.Chase;
    standAt(over.p, over.w.trail!.trailhead.x, over.w.trail!.trailhead.z);
    updateSafety(over.w);
    expect(over.p.safe).toBe(true);
    over.w.state.outcome = Outcome.Won;
    stepSummit(over.w);
    expect(pursuers(over.w)).toHaveLength(0);
    // The rule's own win: the one player safe on the pad.
    const win = forestWorld();
    win.w.state.phase = Phase.Chase;
    standAt(win.p, win.w.trail!.trailhead.x, win.w.trail!.trailhead.z);
    updateSafety(win.w);
    stepSummit(win.w);
    expect(win.w.state.outcome).toBe(Outcome.Won);
    // 2026-10-13: 4 before one shade.
    expect(pursuers(win.w)).toHaveLength(1);
  });

  it("stops short of the road's bed when its player is on it, and stands there facing them", () => {
    const { w, p } = won();
    const h = pursuers(w)[0]!;
    // 10 m along the road from the car, 15 m inland, its player on the centreline:
    // it must stop at the line.
    const roadX = 0 - (roadOffset(w, 0, 10) as number);
    h.pos = { x: roadX + 15, y: elevationAt(seed, roadX + 15, 10) + 0.9, z: 10 };
    standAt(p, roadX, 10);
    let nearest = Infinity;
    for (let t = 0; t < 300; t++) {
      tick(w);
      if (u(w, h) < nearest) nearest = u(w, h);
    }
    expect(nearest).toBeCloseTo(7.913393443006555, 6);
    expect(nearest).toBeGreaterThanOrEqual(7.9);
    expect(u(w, h)).toBeLessThan(8);
    expect(h.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(h.yaw).toBeCloseTo(facing(h, p.pos), 9);
  });

  it("kills no one beside it, and in the stare's cone closes the dark only to SHADE_STARE_CAP", () => {
    const { w, p } = won();
    const h = pursuers(w)[0]!;
    // Out in the woods, 40 m from the road, the player unsafe and a hand's breadth from it, looking at it.
    const roadX = h.pos.x - u(w, h);
    const at = { x: roadX + 40, y: elevationAt(seed, roadX + 40, h.pos.z) + 0.9, z: h.pos.z };
    h.pos = { ...at };
    standAt(p, at.x - 0.6, at.z);
    lookAt(p, h.pos);
    for (let t = 0; t < 600; t++) tick(w);
    expect(p.safe).toBe(false);
    expect(p.health).toBe(100);
    expect(w.state.enemies.has(h.id)).toBe(true);
    expect(p.stare).toBeCloseTo(0.45, 6);
    expect(SHADE_STARE_CAP).toBe(0.45);
  });

  it("is in the state's fingerprint, its ai byte 13", () => {
    const { w } = won();
    const print = serializeWorldState(w.state).split("|");
    expect(pursuers(w)).toHaveLength(1);
    for (const e of pursuers(w)) {
      const entry = print.find((part) => part.startsWith(`E${e.id}:`));
      expect(entry).toBeDefined();
      const fields = entry!.slice(`E${e.id}:`.length).split(",");
      expect(fields[8]).toBe("13");
      expect(fields[10]).toBe("25");
    }
    expect(AiState.Pursue).toBe(13);
  });

  it("stands nothing up on a world without a trail's search", () => {
    const { w } = forestWorld();
    w.search = null;
    startPursuit(w);
    expect(pursuers(w)).toHaveLength(0);
  });
});
