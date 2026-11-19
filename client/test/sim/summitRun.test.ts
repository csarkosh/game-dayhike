import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { createForest } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { seedFromToken } from "../../src/game/seed.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT, elevationAt } from "../../src/sim/terrain.js";
import { AiState, Button, DeathCause, Outcome, Phase } from "../../src/sim/types.js";
import { TICK_DT } from "../../src/sim/constants.js";
import { stemNodes } from "../../src/sim/trailRoute.js";
/** The threshold's run (game/cutscene.ts: the last shot less its look and turn): the seconds the scene has the player sprinting before the hunt. */
const SCENE_RUN_S = 1.8;
import { DISCOVERY_RADIUS } from "../../src/sim/summit.js";
import { SUMMIT_REVEAL_S } from "../../src/sim/hollow.js";
import { WAY_RIM_M } from "../../src/sim/wayDown.js";
import { wayOf } from "../../src/sim/wayDraw.js";
import { chaseLinePoint } from "../../src/sim/chaseLine.js";
import { runDown } from "./helpers/wayRunner.js";
import { isOnCorridor } from "../../src/sim/containment.js";
import { WATCH_SALT } from "../../src/sim/watcher.js";
import { escalationTargets } from "../../src/game/escalation.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/**
 * One run end to end on a real forest world, so this file carries a timeout
 * the way `summit.test.ts` does: the first `createForest` on a seed runs past
 * vitest's 5 s default whenever it shares the machine with the other forest
 * suites.
 */
const SUITE = { timeout: timeLimit(120_000) };

describe("one run on the seed `hollow`", SUITE, () => {
  it("climbs the stem, finds the body, is hunted down the way, reaches the road, and wins", () => {
    const seed = seedFromToken("hollow");
    const w = createForestWorld(createForest(seed));
    // The sightings below are the ones in the trees, at the reach's range:
    // the first showings, on the trail, are watcher.test.ts's.
    w.watcher!.active = true;
    w.watcher!.bold = 0;
    // The haunt's shades are haunt.test.ts's: this run pins the Hollows.
    w.haunt!.active = false;
    const p = spawnPlayer(w);
    const graph = w.trail!;
    const chain = stemNodes(graph);
    const at = (n: number) => { const node = graph.nodes[n]!; p.pos = { x: node.x, y: elevationAt(seed, node.x, node.z) + 0.9, z: node.z }; };
    // The climb is every stem node outside the discovery radius, not simply
    // "all but the last": on `hollow` the node before the crest stands 11.3 m
    // from the body, inside the 12 m radius, so standing there IS the find.
    const body = w.search!.body.pos;
    const climb = chain.filter((n) => {
      const node = graph.nodes[n]!;
      const dx = node.x - body.x, dz = node.z - body.z;
      return Math.sqrt(dx * dx + dz * dz) > DISCOVERY_RADIUS;
    });
    // Only the last stride or two is the find: the walk below is the match.
    expect(climb).toEqual(chain.slice(0, climb.length));
    expect(climb.length).toBeGreaterThan(chain.length - 4);
    /**
     * A sighting where the player stands: facing the next stem node up, with
     * the record's rest run out, the watcher shows within 120 ticks at the
     * range the stand's reach sets, the only enemy and a Watch; then a half
     * turn puts it behind, and it is gone the next tick with a new rest drawn.
     */
    const sighting = (n: number, range: number) => {
      const here = graph.nodes[n]!, next = graph.nodes[chain[chain.indexOf(n) + 1]!]!;
      p.yaw = Math.atan2(next.x - here.x, next.z - here.z);
      p.pitch = 0;
      w.watcher!.rest = 0;
      let shown = -1;
      for (let t = 1; t <= 120 && shown < 0; t++) {
        tickWorld(w, new Map());
        if (w.watcher!.id !== -1) shown = t;
      }
      expect(shown, `at ${n}`).toBeGreaterThan(0);
      const seen = [...w.state.enemies.values()];
      expect(seen, `at ${n}`).toHaveLength(1);
      expect(seen[0]!.ai, `at ${n}`).toBe(AiState.Watch);
      expect(seen[0]!.targetId, `at ${n}`).toBe(p.id);
      const d = Math.sqrt((seen[0]!.pos.x - p.pos.x) ** 2 + (seen[0]!.pos.z - p.pos.z) ** 2);
      expect(Math.abs(d - range), `at ${n}: ${d} m`).toBeLessThanOrEqual(0.5);
      p.yaw += Math.PI;
      tickWorld(w, new Map());
      expect(w.state.enemies.size, `at ${n}`).toBe(0);
      expect(w.watcher!.id, `at ${n}`).toBe(-1);
      expect(w.watcher!.rest, `at ${n}`).toBeGreaterThanOrEqual(8);
      expect(w.watcher!.rest, `at ${n}`).toBeLessThanOrEqual(60);
      expect(w.state.phase, `at ${n}`).toBe(Phase.Climb);
    };
    // Up the stem, node by node: the world input rises and nothing hunts.
    // The only enemy the climb ever has is the watcher, and it is seen twice
    // on the way: a quarter of the way up at node 5, where its reach puts it
    // 62 m out, and at the top fork, node 21, 25 m out. Every showing spends
    // an entity id, which nothing below pins. 2026-09-29: the stem below
    // u = 308 m is a new line from the pad (the trail leaves the pad inland
    // now), so the stand a quarter of the way up is node 5, climb 0.27.
    // 2026-10-10: the pond and its loop are gone from this world (no pond
    // loop the build tried here passed the valley lake's rules), so the top
    // fork is the strand's, node 21, at climb 0.63 where fork 36 was
    // at 0.755; 36 is now the stem's fork above node 3. Node 5's reach is
    // 0.27 / 0.63 and its range 62.16 m, where it was 66.77.
    let first = -1;
    let last = -1;
    for (const n of climb) {
      at(n);
      tickWorld(w, new Map());
      const world = escalationTargets(w.state, p.id, graph, w.boxes, w.ground).world;
      expect(world).toBeGreaterThanOrEqual(last);
      if (first < 0) first = world;
      last = world;
      expect(w.state.phase).toBe(Phase.Climb);
      expect(w.state.enemies.size).toBeLessThanOrEqual(1);
      for (const e of w.state.enemies.values()) expect(e.ai).toBe(AiState.Watch);
      if (n === 5) sighting(n, 62.16);
      if (n === 21) sighting(n, 25);
    }
    expect(w.watcher!.rng.rngSeed).not.toBe((seed ^ WATCH_SALT) | 0);
    // Rose, not merely never fell: the pad reads nothing, the last node short
    // of the find reads nearly everything.
    expect(first).toBeLessThan(0.05);
    expect(last).toBeGreaterThan(0.9);
    // The crest: the find.
    at(chain[chain.length - 1]!);
    tickWorld(w, new Map());
    expect(w.state.phase).toBe(Phase.Scene);
    expect(escalationTargets(w.state, p.id, graph, w.boxes, w.ground).world).toBe(1);
    // No watcher survives the flip: the summit Hollow is the only enemy.
    expect(w.watcher!.id).toBe(-1);
    expect(w.state.enemies.size).toBe(1);
    const h = [...w.state.enemies.values()][0]!;
    expect(h.ai).toBe(AiState.Emerge);
    // Through the scene: its last seconds are the threshold (the summit scene), the Hollow walking
    // at the player, who by then has turned and sprints down the stem before the controls are
    // theirs (app.ts drives it); the same here, or the stand ends on top of a player standing still.
    // The way down is long drawn by the find in a match (app.ts steps its draw from ten seconds in): the same here,
    // and the threshold's run is down it, as app.ts's `wayDownFrom` turns the eye.
    wayOf(w);
    const down = chaseLinePoint(w, p.pos.x, p.pos.z, 8, { x: 0, z: 0 })!;
    const runYaw = Math.atan2(down.x - p.pos.x, down.z - p.pos.z);
    const sceneTicks = Math.round(SUMMIT_REVEAL_S / TICK_DT) + 1;
    const runTicks = Math.round(SCENE_RUN_S / TICK_DT);
    for (let i = 0; i < sceneTicks; i++) {
      const running = i >= sceneTicks - 1 - runTicks;
      tickWorld(w, running ? new Map([[p.id, { seq: i, moveX: 0, moveZ: 1, yaw: runYaw, pitch: 0, buttons: Button.Sprint }]]) : new Map());
    }
    expect(h.ai).toBe(AiState.Hunt);
    expect(h.targetId).toBe(p.id);

    // Down the way (wayDown.ts) with real input, as a player who stays in the channel and sprints (wayRunner.ts):
    // prey the whole way, the crest's Hollow the only one (no fork raises another), never on the corridor, and
    // never nearer than a few strides: a sprint outruns it.
    const way = w.way!;
    expect(way.fallback).toBe(false);
    let nearest = Infinity, mostHollows = 0;
    const run = runDown(w, p.id, {
      each: () => {
        mostHollows = Math.max(mostHollows, w.state.enemies.size);
        // Hunted until the road: a player on its safe ground is nobody's prey.
        if (!p.safe) expect(h.targetId).toBe(p.id);
        for (const e of w.state.enemies.values()) {
          expect(isOnCorridor(w, e.pos.x, e.pos.z)).toBe(false);
          nearest = Math.min(nearest, Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z));
        }
      },
    });
    expect(run.cause).toBe(DeathCause.None);
    expect(run.reached).toBe(true);
    expect(run.stalledS).toBeLessThan(3);
    expect(run.maxOff).toBeLessThan(WAY_RIM_M);
    expect(mostHollows).toBe(1);
    expect(nearest).toBeGreaterThan(3);
    // The road ends the match: won on the tick the runner is safe.
    expect(p.safe).toBe(true);
    expect(w.state.outcome).toBe(Outcome.Won);
    expect(p.health).toBeGreaterThan(0);
    expect(w.state.enemies.size).toBe(1);
    for (const e of w.state.enemies.values()) expect(isOnCorridor(w, e.pos.x, e.pos.z)).toBe(false);
  });
});
