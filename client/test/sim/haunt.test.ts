import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import type { World } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, elevationAt } from "../../src/sim/terrain.js";
import { AiState, Phase } from "../../src/sim/types.js";
import type { EnemyState, PlayerState, Vec3 } from "../../src/sim/types.js";
import { PLAYER_EYE_OFFSET, TICK_DT } from "../../src/sim/constants.js";
import type { TrailNode } from "../../src/sim/trail.js";
import { stemNodes } from "../../src/sim/trailRoute.js";
import { isOnCorridor } from "../../src/sim/containment.js";
import { hasLineOfSight } from "../../src/sim/ai.js";
import { climbOf } from "../../src/sim/watcher.js";
import { MIST_AT, MIST_SPAN, actsUnder, DUSK_AT, NIGHT_SPAN } from "../../src/sim/acts.js";
import {
  GUIDE_REACH, HAUNT_MIST_MIN, HAUNT_PRESS_SPAN, HAUNT_REAL_CHASE, HAUNT_REAL_CLIMB, HAUNT_REST_EARLY, HAUNT_REST_LATE, HAUNT_SHADES_EARLY, HAUNT_SHADES_LATE, LUNGE_ATTACK_M, LUNGE_ATTACK_S, LUNGE_MAX_S,
  LUNGE_RANGE, SHADE_BEARING_MAX_COS, SHADE_BEARING_MIN_COS, SHADE_DWELL_S, SHADE_FLEE_RADIUS, SHADE_RANGE, SHADE_WATCHED_S, OFF_TRAIL_FROM_M, OFF_TRAIL_SPAN_M, OFF_TRAIL_REAL_EACH, offTrailOf,
  bestClimb, isHaunting, isShadeState, placeShadeOnGuide, pressureOf, spawnShade,
} from "../../src/sim/haunt.js";
import { isHollow, SHADE_STARE_CAP, SUMMIT_REVEAL_S, spawnHollow } from "../../src/sim/hollow.js";
import { trailDistance } from "../../src/sim/trail.js";

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
  });

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
