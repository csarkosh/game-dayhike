import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { ROAD_WALL_U, containAtLake, containAtRoad, waterLevelAt } from "../../src/sim/containment.js";
import { ROAD_BED_HALF } from "../../src/sim/road.js";
import { ENEMY_HALF, PLAYER_HALF } from "../../src/sim/constants.js";
import { spawnHollow } from "../../src/sim/hollow.js";
import { createForest, GEN_VERSION } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { activeTerrainVariant, elevationAt, type LakeSource } from "../../src/sim/terrain.js";
import { LAKE_SHELF_WIDTH } from "../../src/sim/features.js";
import { LOBBY_SEEDS } from "./trailGateSeeds.js";
import { CAR_HALF, CAR_ROAD_U } from "../../src/sim/trailhead.js";
import type { InputCommand } from "../../src/sim/types.js";
import { timeLimit } from "../helpers/timeLimit.js";

const input = (over: Partial<InputCommand> = {}): InputCommand =>
  ({ seq: 1, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0, ...over });

describe("containAtRoad", () => {
  it("is the pavement's edge plus half a metre plus the hull's half-width", () => {
    expect(ROAD_WALL_U).toBeCloseTo(ROAD_BED_HALF + 0.5 + PLAYER_HALF.x, 9);
  });

  it("clamps a hull inside the wall back to it and cancels the velocity into it", () => {
    const pos = { x: 100 + ROAD_WALL_U - 0.7, y: 1, z: 0 };
    const vel = { x: -3, y: 0, z: 2 };
    expect(containAtRoad(pos, vel, 100)).toBe(true);
    expect(pos.x).toBeCloseTo(100 + ROAD_WALL_U, 9);
    expect(vel).toEqual({ x: 0, y: 0, z: 2 });
  });

  it("leaves a hull inland of the wall alone, velocity included", () => {
    const pos = { x: 100 + ROAD_WALL_U + 0.01, y: 1, z: 0 };
    const vel = { x: -3, y: 0, z: 0 };
    expect(containAtRoad(pos, vel, 100)).toBe(false);
    expect(vel.x).toBe(-3);
  });
});

describe("the wall in a forest world", { timeout: timeLimit(120_000) }, () => {
  it("never lets a player onto the pavement from any direction, and the car stays within reach of the win", () => {
    const v = activeTerrainVariant();
    for (const seed of [0x5eed, 1, 12345]) {
      const world = createForestWorld(createForest(seed));
      const roadX = (z: number) => v.roadCenterX!(seed, z);
      // Eight headings; yaw 0 faces +z, PI/2 faces +x, so -PI/2 walks toward the road.
      for (let k = 0; k < 8; k++) {
        const yaw = (k / 8) * Math.PI * 2;
        const p = spawnPlayer(world);
        for (let t = 0; t < 900; t++) {
          tickWorld(world, new Map([[p.id, input({ seq: t + 1, moveZ: 1, yaw })]]));
          expect(p.pos.x - roadX(p.pos.z), `seed ${seed} heading ${k} tick ${t}`).toBeGreaterThanOrEqual(ROAD_WALL_U - 1e-6);
        }
        world.state.players.delete(p.id);
      }
      // Standing against the car's inland face leaves the wall between the
      // player and the pavement, and puts them within arm's reach of the car:
      // whatever ends the match at the car has to be reachable from here.
      const car = world.search!.car;
      const p = spawnPlayer(world);
      p.pos = { x: car.x + CAR_HALF.x + PLAYER_HALF.x + 0.05, y: elevationAt(seed, car.x, car.z) + PLAYER_HALF.y, z: car.z };
      for (let t = 0; t < 60; t++) tickWorld(world, new Map([[p.id, input({ seq: t + 1 })]]));
      const dx = p.pos.x - car.x, dz = p.pos.z - car.z;
      expect(Math.sqrt(dx * dx + dz * dz), `seed ${seed} car`).toBeLessThan(4);
      expect(p.pos.x - roadX(p.pos.z)).toBeGreaterThanOrEqual(ROAD_WALL_U - 1e-6);
      expect(CAR_ROAD_U - CAR_HALF.x).toBeCloseTo(ROAD_BED_HALF + 0.5, 9);
    }
    // 5 was the wall at the road; 6, the ground's stick standing a hull on a
    // box top; 7, the car at the pad, the sign at the trail's entrance and
    // the player facing the trail; 8, the trail from the treeline. Either way
    // no peer from before can join.
    expect(GEN_VERSION).toBe(8);
  });
});

describe("containAtLake", () => {
  it("puts a hull inside the wall back on it and cancels the velocity into the lake", () => {
    const pos = { x: 100 + 5, y: 1, z: 50 };
    const vel = { x: -3, y: 0, z: 2 };
    expect(containAtLake(pos, vel, 100, 50, 12)).toBe(true);
    expect(pos.x).toBeCloseTo(112, 9);
    expect(pos.z).toBeCloseTo(50, 9);
    expect(vel).toEqual({ x: 0, y: 0, z: 2 });
  });

  it("puts a hull at the very centre out along +x", () => {
    const pos = { x: 100, y: 1, z: 50 };
    const vel = { x: 0, y: 0, z: 0 };
    expect(containAtLake(pos, vel, 100, 50, 12)).toBe(true);
    expect(pos).toEqual({ x: 112, y: 1, z: 50 });
  });

  it("leaves a hull on the shelf alone, velocity included", () => {
    const pos = { x: 100 + 12.01, y: 1, z: 50 };
    const vel = { x: -3, y: 0, z: 0 };
    expect(containAtLake(pos, vel, 100, 50, 12)).toBe(false);
    expect(vel.x).toBe(-3);
  });
});

describe("the lake in a forest world", { timeout: timeLimit(240_000) }, () => {
  /** The first lobby world with a lake: found inside a test, never while the
   * file is collected (each world is a bowl build). */
  function lakeWorld(): { seed: number; lake: LakeSource; wallQ: number } {
    const v = activeTerrainVariant();
    for (const seed of LOBBY_SEEDS) {
      const lake = v.waterBodies!(seed).find((b): b is LakeSource => b.kind === "lake");
      if (lake !== undefined) return { seed, lake, wallQ: lake.radius - LAKE_SHELF_WIDTH };
    }
    throw new Error("no lake in the lobby worlds");
  }

  it("never lets a player past the shelf's edge, whichever way they walk in", () => {
    const { seed, lake, wallQ } = lakeWorld();
    const world = createForestWorld(createForest(seed));
    let nearest = Infinity;
    for (let k = 0; k < 16; k++) {
      const yaw = (k / 16) * Math.PI * 2;
      const p = spawnPlayer(world);
      const x = lake.x + lake.radius, z = lake.z;
      p.pos = { x, y: elevationAt(seed, x, z) + PLAYER_HALF.y, z };
      for (let t = 0; t < 600; t++) {
        tickWorld(world, new Map([[p.id, input({ seq: t + 1, moveZ: 1, yaw })]]));
        const q = Math.hypot(p.pos.x - lake.x, p.pos.z - lake.z);
        nearest = Math.min(nearest, q);
        expect(q, `heading ${k} tick ${t}`).toBeGreaterThanOrEqual(wallQ - 1e-6);
      }
      world.state.players.delete(p.id);
    }
    // the mechanism fired: some heading walked all the way to the wall
    expect(nearest).toBeLessThan(wallQ + 0.5);
  });

  it("puts a player placed at the lake's centre on the wall after one tick", () => {
    const { seed, lake, wallQ } = lakeWorld();
    const world = createForestWorld(createForest(seed));
    const p = spawnPlayer(world);
    p.pos = { x: lake.x, y: elevationAt(seed, lake.x, lake.z) + PLAYER_HALF.y, z: lake.z };
    tickWorld(world, new Map([[p.id, input({ seq: 1 })]]));
    expect(Math.hypot(p.pos.x - lake.x, p.pos.z - lake.z)).toBeCloseTo(wallQ, 6);
  });

  it("lifts a player the wall moves out onto the ground there", () => {
    const { seed, lake } = lakeWorld();
    const world = createForestWorld(createForest(seed));
    const p = spawnPlayer(world);
    p.pos = { x: lake.x, y: elevationAt(seed, lake.x, lake.z) + PLAYER_HALF.y, z: lake.z };
    tickWorld(world, new Map([[p.id, input({ seq: 1 })]]));
    expect(p.pos.y).toBeGreaterThanOrEqual(world.ground!.heightAt(p.pos.x, p.pos.z) + PLAYER_HALF.y - 1e-9);
  });

  it("holds a Hollow at the wall as it holds a player, chasing across the lake included", () => {
    const { seed, lake, wallQ } = lakeWorld();
    const world = createForestWorld(createForest(seed));
    const p = spawnPlayer(world);
    // the prey stands at the wall on the far side, so the chase is straight across
    const px = lake.x - wallQ, pz = lake.z;
    p.pos = { x: px, y: elevationAt(seed, px, pz) + PLAYER_HALF.y, z: pz };
    const h = spawnHollow(world, { x: lake.x + 0.5, y: elevationAt(seed, lake.x + 0.5, lake.z) + ENEMY_HALF.y, z: lake.z }, p.id, 0);
    // A Hollow decides on its approach in one tick and takes its first step
    // the next (`pursue`): it is on the wall after the tick it first moves.
    const start = { ...h.pos };
    let t = 0;
    while (t < 5 && h.pos.x === start.x && h.pos.z === start.z) {
      t++;
      tickWorld(world, new Map([[p.id, input({ seq: t })]]));
    }
    expect(t).toBeLessThanOrEqual(2);
    expect(Math.hypot(h.pos.x - lake.x, h.pos.z - lake.z)).toBeCloseTo(wallQ, 6);
    expect(h.pos.y).toBeGreaterThanOrEqual(world.ground!.heightAt(h.pos.x, h.pos.z) + ENEMY_HALF.y - 1e-9);
    for (; t < 600 && world.state.enemies.has(h.id); t++) {
      tickWorld(world, new Map([[p.id, input({ seq: t + 1 })]]));
      expect(Math.hypot(h.pos.x - lake.x, h.pos.z - lake.z), `tick ${t}`).toBeGreaterThanOrEqual(wallQ - 1e-6);
    }
  });

  it("wades by the lake's level within its rim and by the sea's elsewhere", () => {
    const { seed, lake } = lakeWorld();
    const world = createForestWorld(createForest(seed));
    expect(waterLevelAt(world, lake.x + lake.radius - 3, lake.z)).toBe(lake.level);
    expect(waterLevelAt(world, lake.x + lake.radius + 200, lake.z)).toBe(world.waterLevel);
  });
});
