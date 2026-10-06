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
import { actsUnder, DUSK_AT, NIGHT_SPAN } from "../../src/sim/acts.js";
import {
  GUIDE_REACH, HAUNT_NIGHT_MIN, HAUNT_REST_CLIMB, HAUNT_SHADES, LUNGE_MAX_S, LUNGE_RANGE, SHADE_DWELL_S, SHADE_FLEE_RADIUS,
  SHADE_RANGE, SHADE_WATCHED_S, bestClimb, isHaunting, isShadeState, placeShadeOnGuide, spawnShade,
} from "../../src/sim/haunt.js";
import { isHollow } from "../../src/sim/hollow.js";

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
const NIGHT_CLIMB = DUSK_AT + NIGHT_SPAN * 0.6;

describe("the director", () => {
  it("is made for every authoritative forest world, active, with its first rest drawn, and runs nothing by day", () => {
    const { w, p } = forestWorld();
    expect(w.haunt).not.toBeNull();
    expect(w.haunt!.active).toBe(true);
    expect(w.haunt!.rest).toBeGreaterThanOrEqual(HAUNT_REST_CLIMB[0]);
    expect(w.haunt!.rest).toBeLessThanOrEqual(HAUNT_REST_CLIMB[1]);
    standAtClimb(w, p, 0.2);
    expect(isHaunting(w)).toBe(false);
    const rest = w.haunt!.rest;
    tick(w, 300);
    expect(w.haunt!.rest).toBe(rest);
    expect(w.state.enemies.size).toBe(0);
    expect(createForestWorld(createForest(seed), false).haunt).toBeNull();
  });

  it("haunts once the night is in, by the best living climb, and through the chase", () => {
    const { w, p } = forestWorld();
    standAtClimb(w, p, NIGHT_CLIMB);
    expect(actsUnder(bestClimb(w)).night).toBeGreaterThanOrEqual(HAUNT_NIGHT_MIN);
    expect(isHaunting(w)).toBe(true);
    p.health = 0;
    expect(bestClimb(w)).toBe(0);
    expect(isHaunting(w)).toBe(false);
    w.state.phase = Phase.Chase;
    expect(isHaunting(w)).toBe(true);
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
    expect(h.stateTimer).toBeGreaterThan(SHADE_DWELL_S[0] - TICK_DT * 2);
    // The episode goes on: more of them, and the count is the episode's.
    expect(w.haunt!.episode).not.toBeNull();
    expect(w.haunt!.episode!.shades).toBeLessThanOrEqual(HAUNT_SHADES[1] - 1);
    // Harmless: standing on it costs nothing but its presence.
    tick(w, 60);
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

  it("a lunge walks its line at its player and kills on contact; a player who steps out of its line sees it pass and go", () => {
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
    // Standing still: it reaches them.
    let touched = -1;
    for (let t = 0; t < 300 && touched < 0; t++) {
      tick(w);
      if (p.health <= 0) touched = t;
    }
    expect(touched).toBeGreaterThanOrEqual(0);

    // Again, and this time they step out of its line: it passes, and is gone, and they live.
    const { w: w2, p: q } = forestWorld();
    standAtClimb(w2, q, 0.3);
    const from2 = { x: q.pos.x + Math.sin(q.yaw) * 22, y: 0, z: q.pos.z + Math.cos(q.yaw) * 22 };
    from2.y = elevationAt(seed, from2.x, from2.z) + 1;
    const l = spawnShade(w2, from2, q, true, 0);
    tick(w2, 30);
    // Six metres across the line, more than the drift can follow.
    standAt(q, q.pos.x + Math.cos(q.yaw) * 6, q.pos.z - Math.sin(q.yaw) * 6);
    let gone = -1;
    for (let t = 0; t < Math.round(LUNGE_MAX_S / TICK_DT) + 10 && gone < 0; t++) {
      tick(w2);
      if (!w2.state.enemies.has(l.id)) gone = t;
    }
    expect(gone).toBeGreaterThanOrEqual(0);
    expect(q.health).toBe(100);
    expect(LUNGE_RANGE[0]).toBeGreaterThan(SHADE_FLEE_RADIUS);
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
