import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { ROAD_WALL_U, containAtRoad } from "../../src/sim/containment.js";
import { ROAD_BED_HALF } from "../../src/sim/road.js";
import { PLAYER_HALF } from "../../src/sim/constants.js";
import { createForest, GEN_VERSION } from "../../src/sim/forest.js";
import { createForestWorld, spawnPlayer, tickWorld } from "../../src/sim/world.js";
import { activeTerrainVariant, elevationAt } from "../../src/sim/terrain.js";
import { CAR_HALF, CAR_ROAD_U } from "../../src/sim/passes/trailhead.js";
import type { InputCommand } from "../../src/sim/types.js";

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

describe("the wall in a forest world", { timeout: 120_000 }, () => {
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
      const car = world.register!.car;
      const p = spawnPlayer(world);
      p.pos = { x: car.x + CAR_HALF.x + PLAYER_HALF.x + 0.05, y: elevationAt(seed, car.x, car.z) + PLAYER_HALF.y, z: car.z };
      for (let t = 0; t < 60; t++) tickWorld(world, new Map([[p.id, input({ seq: t + 1 })]]));
      const dx = p.pos.x - car.x, dz = p.pos.z - car.z;
      expect(Math.sqrt(dx * dx + dz * dz), `seed ${seed} car`).toBeLessThan(4);
      expect(p.pos.x - roadX(p.pos.z)).toBeGreaterThanOrEqual(ROAD_WALL_U - 1e-6);
      expect(CAR_ROAD_U - CAR_HALF.x).toBeCloseTo(ROAD_BED_HALF + 0.5, 9);
    }
    // 5 was the wall at the road; 6, the ground's stick standing a hull on a
    // box top. Either way no peer from before the wall can join.
    expect(GEN_VERSION).toBe(6);
  });
});
