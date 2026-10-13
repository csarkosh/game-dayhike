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
import { PLAYER_EYE_OFFSET, TICK_DT } from "../../src/sim/constants.js";
import type { TrailNode } from "../../src/sim/trail.js";
import { stemAhead, stemNodes } from "../../src/sim/trailRoute.js";
import { isOnCorridor, roadOffset } from "../../src/sim/containment.js";
import { hasLineOfSight } from "../../src/sim/ai.js";
import { climbOf } from "../../src/sim/watcher.js";
import { MIST_AT, MIST_SPAN, actsUnder, DUSK_AT, NIGHT_SPAN } from "../../src/sim/acts.js";
import {
  GUIDE_REACH, HAUNT_MIST_MIN, HAUNT_PRESS_SPAN, HAUNT_REAL_CHASE, HAUNT_REAL_CLIMB, HAUNT_REST_EARLY, HAUNT_REST_LATE, HAUNT_SHADES_EARLY, HAUNT_SHADES_LATE, LUNGE_ATTACK_M, LUNGE_ATTACK_S, LUNGE_MAX_S,
  LUNGE_RANGE, SHADE_BEARING_MAX_COS, SHADE_BEARING_MIN_COS, SHADE_DWELL_S, SHADE_FLEE_RADIUS, SHADE_RANGE, SHADE_WATCHED_S, OFF_TRAIL_FROM_M, OFF_TRAIL_SPAN_M, OFF_TRAIL_REAL_EACH, offTrailOf,
  bestClimb, isHaunting, isShadeState, placeShadeOnGuide, pressureOf, spawnShade, startPursuit,
} from "../../src/sim/haunt.js";
import { isHollow, SHADE_STARE_CAP, SUMMIT_REVEAL_S, spawnHollow } from "../../src/sim/hollow.js";
import { trailDistance } from "../../src/sim/trail.js";
import { stepSummit, updateSafety } from "../../src/sim/summit.js";
import { carDirection, doorSpot } from "../../src/sim/trailhead.js";

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
  const pursuers = (w: World): EnemyState[] => [...w.state.enemies.values()].filter((e) => e.ai === AiState.Pursue);
  const u = (w: World, e: EnemyState) => roadOffset(w, e.pos.x, e.pos.z) as number;

  it("with every winner on the pad, stands four shades of the end up on the winning tick at the trail's entrance and 4, 8 and 12 m back up the stem, once", () => {
    const { w, p } = won();
    expect(w.state.outcome).toBe(Outcome.Won);
    const four = pursuers(w);
    expect(four.map((e) => e.id)).toEqual([2, 3, 4, 5]);
    const places = [
      [-305.7794721388503, 4.058108456105842, 0.9167297835065525],
      [-301.80582121985805, 4.67193263960374, 1.3750946752598288],
      [-297.83217030086576, 5.6656172401254645, 1.833459567013105],
      [-293.8585193818735, 6.470820654537182, 2.2918244587663814],
    ];
    for (const [k, e] of four.entries()) {
      const [x, y, z] = places[k] as [number, number, number];
      expect(e.pos.x).toBeCloseTo(x, 6);
      expect(e.pos.y).toBeCloseTo(y, 6);
      expect(e.pos.z).toBeCloseTo(z, 6);
      expect(e.targetId).toBe(p.id);
      expect(e.stateTimer).toBe(25);
      // Bound for its own stop: the door spot is inland of the car and half a metre ahead of its
      // centre (the car faces +z here, the door at z 0.5); the first stop 1.8 m back along the road
      // from it, each after that 1.8 m further, so the door is the runner's.
      expect(e.emergeTo!.x).toBeCloseTo(-314.32677397683483, 6);
      expect(e.emergeTo!.z).toBeCloseTo([-1.3, -3.1, -4.9, -6.7][k] as number, 9);
      expect(isShadeState(e.ai)).toBe(true);
      expect(isHollow(e)).toBe(false);
    }
    // 4 m apart along the stem's first edge.
    expect(dist(four[0]!.pos, four[1]!.pos)).toBeCloseTo(4, 9);
    expect(dist(four[0]!.pos, four[3]!.pos)).toBeCloseTo(12, 9);
    // Never a second time: the match is over and the end rule judges nothing more.
    tick(w, 120);
    expect(pursuers(w).map((e) => e.id)).toEqual([2, 3, 4, 5]);
    expect(w.state.nextEntityId).toBe(6);
  });

  it("in a win made on the stem, at the corridor's edge, rises behind the winner and reaches its stop after a runner would reach the door", () => {
    const { w, p } = forestWorld();
    w.state.phase = Phase.Chase;
    const graph = w.trail!;
    const roadU = (x: number, z: number) => roadOffset(w, x, z) as number;
    // Up the stem until outside the corridor, then down it a tenth of a metre a tick until the win.
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
    const car = w.search!.car;
    const door = doorSpot(car, carDirection(car, graph.trailhead));
    // The win, a hand's breadth inside the corridor's 30 m, 22.99 m from the car and 21.45 m from its door.
    expect(roadU(p.pos.x, p.pos.z)).toBeCloseTo(29.955935177077265, 6);
    expect(dist(p.pos, car)).toBeCloseTo(22.987426333046642, 6);
    expect(dist(p.pos, { x: door.x, y: 0, z: door.z })).toBeCloseTo(21.446207932933838, 6);
    // Each rises up the stem behind them, 3, 7, 11 and 15 m back, further from the car than they are.
    const four = pursuers(w);
    const places = [
      [-289.98420973585695, 6.98788189907859, 2.7387302282257253, 25.987280923791662],
      [-286.01055881686466, 7.497313999465884, 3.1970951199790014, 29.987132301569424],
      [-282.0369078978724, 8.132149257253978, 3.655460011732278, 33.98701866200665],
      [-278.32104826013057, 8.540789300678323, 3.3252698014535405, 37.652846914796626],
    ];
    for (const [k, e] of four.entries()) {
      const [x, y, z, fromCar] = places[k] as [number, number, number, number];
      expect(e.pos.x).toBeCloseTo(x, 6);
      expect(e.pos.y).toBeCloseTo(y, 6);
      expect(e.pos.z).toBeCloseTo(z, 6);
      expect(dist(e.pos, car)).toBeCloseTo(fromCar, 6);
      expect(fromCar).toBeGreaterThan(22.987426333046642);
    }
    // A runner at 7 m/s from the winner's spot is at the door in 21.446 / 7 = 3.064 s; the first shade
    // is within a metre of its stop 262 ticks (4.367 s) after the win.
    let reached = -1;
    for (let t = 1; t < 900 && reached < 0; t++) {
      tick(w);
      if (dist(four[0]!.pos, four[0]!.emergeTo!) <= 1) reached = t;
    }
    expect(reached).toBe(262);
    expect(reached * TICK_DT).toBeGreaterThan(3.064);
  });

  it("one that starts nearer the road than the stop may still step away from it", () => {
    const { w } = won();
    const h = pursuers(w)[0]!;
    // 7 m from the centreline, 10 m along the road from the car, bound inland.
    const roadX = h.pos.x - u(w, h);
    h.pos = { x: roadX + 7, y: elevationAt(seed, roadX + 7, 10) + 0.9, z: 10 };
    h.emergeTo = { x: roadX + 20, y: 0, z: 10 };
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
    const lost = forestWorld();
    lost.w.state.phase = Phase.Chase;
    lost.w.state.outcome = Outcome.Lost;
    stepSummit(lost.w);
    expect(pursuers(lost.w)).toHaveLength(0);
    const over = forestWorld();
    over.w.state.phase = Phase.Chase;
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
    expect(pursuers(win.w)).toHaveLength(4);
  });

  it("walks to the car at 5.5 m/s, stands in a file along the car's flank within a metre of its own stop, facing the car, never nearer the road than 7.9 m, and is gone after 25 s", () => {
    const { w } = won();
    const four = pursuers(w);
    const last = four[3]!;
    // Settled past its first steps from a standstill, a second's walk is 5.5 m.
    tick(w, 15);
    const from = { ...last.pos };
    tick(w, 60);
    expect(dist(last.pos, from)).toBeCloseTo(5.5, 6);
    const car = w.search!.car;
    let nearest = Infinity;
    for (let t = 75; t < 1499; t++) {
      tick(w);
      for (const e of four) {
        const off = u(w, e);
        if (off < nearest) nearest = off;
      }
    }
    // Never on the pavement (5.5 m), never past the stop at 7.9 m from the centreline.
    expect(nearest).toBeGreaterThanOrEqual(7.9);
    // At rest: a loose file from the door back past the car's tail (the car is 4.6 m long, its tail at z −2.3).
    const rest = [
      [-313.43771672102775, -1.0694243475255991],
      [-313.3992014004798, -2.7684776967114146],
      [-313.4739893100284, -4.551874565396182],
      [-313.4390087571927, -6.309999524943129],
    ];
    for (const [k, e] of four.entries()) {
      const [x, z] = rest[k] as [number, number];
      expect(e.pos.x).toBeCloseTo(x, 6);
      expect(e.pos.z).toBeCloseTo(z, 6);
    }
    for (let i = 0; i < four.length; i++) {
      for (let j = i + 1; j < four.length; j++) expect(dist(four[i]!.pos, four[j]!.pos)).toBeGreaterThanOrEqual(1.5);
    }
    for (const e of four) {
      expect(w.state.enemies.has(e.id)).toBe(true);
      expect(dist(e.pos, e.emergeTo!)).toBeLessThanOrEqual(1);
      expect(e.vel).toEqual({ x: 0, y: 0, z: 0 });
      expect(e.yaw).toBeCloseTo(Math.atan2(car.x - e.pos.x, car.z - e.pos.z), 9);
    }
    tick(w, 2);
    expect(pursuers(w)).toHaveLength(0);
  }, timeLimit(30_000));

  it("stops short of the road's bed when its way runs onto it, and stands there facing the car", () => {
    const { w } = won();
    const h = pursuers(w)[0]!;
    // Its way to the door laid across the road's centreline, at its own z: it must stop at the line.
    const roadX = h.pos.x - u(w, h);
    h.emergeTo = { x: roadX, y: 0, z: h.pos.z };
    let nearest = Infinity;
    for (let t = 0; t < 300; t++) {
      tick(w);
      if (u(w, h) < nearest) nearest = u(w, h);
    }
    expect(nearest).toBeGreaterThanOrEqual(7.9);
    expect(u(w, h)).toBeLessThan(8);
    expect(h.vel).toEqual({ x: 0, y: 0, z: 0 });
    const car = w.search!.car;
    expect(h.yaw).toBeCloseTo(Math.atan2(car.x - h.pos.x, car.z - h.pos.z), 9);
  });

  it("kills no one beside it, and in the stare's cone closes the dark only to SHADE_STARE_CAP", () => {
    const { w, p } = won();
    const h = pursuers(w)[0]!;
    // Out in the woods, 40 m from the road, the player unsafe and a hand's breadth from it, looking at it.
    const roadX = h.pos.x - u(w, h);
    const at = { x: roadX + 40, y: elevationAt(seed, roadX + 40, h.pos.z) + 0.9, z: h.pos.z };
    for (const e of pursuers(w)) if (e !== h) w.state.enemies.delete(e.id);
    h.pos = { ...at };
    h.emergeTo = { ...at };
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
