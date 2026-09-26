import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { clipForEnemy, EntityViews } from "../../src/game/entityViews.js";
import { LAMP_INTENSITY, LIGHT_BUDGET, budgetLights, createHeadlamp, setLamp } from "../../src/game/headlamp.js";
import { AiState } from "../../src/sim/types.js";
import type { PlayerState, WorldState } from "../../src/sim/types.js";
import { ENEMY_HALF, MAX_PLAYERS, PLAYER_EYE_OFFSET } from "../../src/sim/constants.js";
import { Outcome, Phase } from "../../src/sim/types.js";
import { HOLLOW_HEIGHT } from "../../src/sim/hollow.js";

describe("clipForEnemy", () => {
  it("plays idle when standing around", () => {
    expect(clipForEnemy({ health: 40, ai: AiState.Idle })).toBe("idle");
  });

  it("plays walk while chasing", () => {
    expect(clipForEnemy({ health: 40, ai: AiState.Chase })).toBe("walk");
  });

  it("plays attack while attacking", () => {
    expect(clipForEnemy({ health: 40, ai: AiState.Attack })).toBe("attack");
  });

  it("plays death once dead", () => {
    expect(clipForEnemy({ health: 0, ai: AiState.Dead })).toBe("death");
  });

  it("plays death on zero health even before the state machine catches up", () => {
    expect(clipForEnemy({ health: 0, ai: AiState.Chase })).toBe("death");
  });

  // Enemy velocity is not in the snapshot, so a joining client sees every
  // remote enemy with a zeroed vector. Selecting on speed would leave them all
  // standing still on every machine except the host's.
  it("does not depend on velocity, which is never networked", () => {
    expect(clipForEnemy({ health: 40, ai: AiState.Chase })).toBe("walk");
    expect(clipForEnemy({ health: 40, ai: AiState.Idle })).toBe("idle");
  });
});

let engine: NullEngine;
let scene: Scene;
beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterAll(() => {
  scene.dispose();
  engine.dispose();
});

function player(id: number, on: boolean, yaw = 0): PlayerState {
  return {
    id,
    pos: { x: id, y: 0.9, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    health: 100,
    grounded: true,
    lastProcessedInput: 0,
    deathPos: null,
    lamp: { on, charge: 1 },
    stare: 0,
    safe: false,
  };
}
function state(...players: PlayerState[]): WorldState {
  return {
    tick: 1, players: new Map(players.map((p) => [p.id, p])), enemies: new Map(),
    outcome: Outcome.Playing, phase: Phase.Climb, nextEntityId: 10, rngSeed: 1,
  };
}

describe("headlamp", () => {
  it("is a spot light that starts dark and casts no shadows", () => {
    const l = createHeadlamp(scene, "lamp_t");
    expect(l).toBeInstanceOf(SpotLight);
    expect(l.intensity).toBe(0);
    expect(l.getShadowGenerator()).toBeNull();
    setLamp(l, true);
    expect(l.intensity).toBe(LAMP_INTENSITY);
    setLamp(l, false);
    expect(l.intensity).toBe(0);
    l.dispose();
  });

  it("raises every material's light cap to sun + fill + one lamp per player, including materials added later", async () => {
    const s = new Scene(engine);
    const before = new PBRMaterial("mat_before", s);
    budgetLights(s);
    const after = new PBRMaterial("mat_after", s);
    expect(LIGHT_BUDGET).toBe(2 + MAX_PLAYERS);
    expect(before.maxSimultaneousLights).toBe(LIGHT_BUDGET);
    // Babylon fires onNewMaterialAddedObservable via TimingTools.SetImmediate
    // (a 1 ms setTimeout), not synchronously on construction, so the callback
    // for `after` has not run yet at this point in the test.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(after.maxSimultaneousLights).toBe(LIGHT_BUDGET);
    s.dispose();
  });
});

describe("EntityViews lamps", () => {
  it("gives every remote player a lamp that follows lamp.on, and the local player none", () => {
    const views = new EntityViews(scene);
    const before = scene.lights.length;
    views.sync(state(player(1, true), player(2, false), player(3, true, 1.2)), 1, 1);
    const lamps = scene.lights.filter((l) => l.name.startsWith("lamp_player_")) as SpotLight[];
    expect(lamps.map((l) => l.name).sort()).toEqual(["lamp_player_2", "lamp_player_3"]);
    expect(lamps.find((l) => l.name === "lamp_player_2")!.intensity).toBe(0);
    expect(lamps.find((l) => l.name === "lamp_player_3")!.intensity).toBe(LAMP_INTENSITY);
    // Steered by the player's yaw: yaw 1.2 → direction (sin 1.2, 0, cos 1.2).
    const d = lamps.find((l) => l.name === "lamp_player_3")!.direction;
    expect(d.x).toBeCloseTo(Math.sin(1.2), 5);
    expect(d.z).toBeCloseTo(Math.cos(1.2), 5);
    views.sync(state(player(1, true)), 1, 1);
    expect(scene.lights.filter((l) => l.name.startsWith("lamp_player_"))).toHaveLength(0);
    views.dispose();
    expect(scene.lights.length).toBe(before);
  });
});

describe("EntityViews placement", () => {
  it("draws a player where they stand from their first frame, before they ever move", () => {
    const views = new EntityViews(scene);
    const still = { ...player(2, false), pos: { x: 7, y: 0.9, z: -3 } };
    // Seen mid-tick on the very first sync: there is no earlier position to
    // interpolate from, so the only right answer is where they are.
    views.sync(state(player(1, false), still), 1, 0.5);
    const mesh = scene.getMeshByName("player_2")!;
    expect(mesh.position.asArray()).toEqual([7, 0.9, -3]);
    const lamp = scene.lights.find((l) => l.name === "lamp_player_2") as SpotLight;
    expect(lamp.position.asArray()).toEqual([7, 0.9 + PLAYER_EYE_OFFSET, -3]);
    // And still there while they keep standing, whatever the frame's alpha.
    views.sync(state(player(1, false), still), 1, 0.2);
    expect(mesh.position.asArray()).toEqual([7, 0.9, -3]);
    views.dispose();
  });
});

describe("EntityViews Hollows", () => {
  it("draws a Hollow as a black, unlit, fog-free StandardMaterial capsule and never as a chaser", () => {
    const views = new EntityViews(scene);
    const world = state();
    world.enemies.set(7, {
      id: 7, pos: { x: 1, y: 0.9, z: 2 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0.5, health: 40, ai: AiState.Stand,
      targetId: 0, stateTimer: 0, attackCooldown: 0, lastDistSq: Infinity, stuckTimer: 0, unstickTimer: 0,
      route: [], routeAt: 0, approach: false, seen: false, emergeTo: null,
    });
    views.sync(world, 99, 0);
    const mesh = scene.getMeshByName("hollow_7")!;
    expect(mesh).not.toBeNull();
    expect(scene.getMeshByName("enemy_7")).toBeNull();
    const material = mesh.material as StandardMaterial;
    expect(material.fogEnabled).toBe(false);
    expect(material.disableLighting).toBe(true);
    expect(material.diffuseColor.equals(new Color3(0, 0, 0))).toBe(true);
    expect(material.emissiveColor.equals(new Color3(0, 0, 0))).toBe(true);
    expect(mesh.rotation.y).toBeCloseTo(0.5, 9);
    // The hull centre is 0.9 m up; the 2.6 m capsule's centre sits 0.4 m higher so its feet meet the hull's.
    expect(mesh.position.y).toBeCloseTo(0.9 + (HOLLOW_HEIGHT / 2 - ENEMY_HALF.y), 6);
    views.dispose();
  });
});
