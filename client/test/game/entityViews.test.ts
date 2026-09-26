import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { SpotLight } from "@babylonjs/core/Lights/spotLight.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { readFileSync } from "node:fs";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { EntityViews } from "../../src/game/entityViews.js";
import { createCharacterPool, type CharacterLoader, type CharacterPool } from "../../src/game/characterModel.js";
import type { EnemyState } from "../../src/sim/types.js";
import { LAMP_INTENSITY, LIGHT_BUDGET, budgetLights, createHeadlamp, setLamp } from "../../src/game/headlamp.js";
import { AiState } from "../../src/sim/types.js";
import catalog from "../../assets/catalog.json" with { type: "json" };
import type { PlayerState, WorldState } from "../../src/sim/types.js";
import { MAX_PLAYERS } from "../../src/sim/constants.js";
import { Outcome, Phase } from "../../src/sim/types.js";

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
function hollow(id: number, x: number, z: number, yaw = 0): EnemyState {
  return {
    id, pos: { x, y: 0.9, z }, vel: { x: 0, y: 0, z: 0 }, yaw, health: 40, ai: AiState.Stand,
    targetId: 0, stateTimer: 0, attackCooldown: 0, lastDistSq: Infinity, stuckTimer: 0, unstickTimer: 0,
    route: [], routeAt: 0, approach: false, seen: false, emergeTo: null,
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
    // A capsule's centre is the hull's, so the eyes are 0.7 m above it.
    expect(lamp.position.x).toBe(7);
    expect(lamp.position.y).toBeCloseTo(1.6, 9);
    expect(lamp.position.z).toBe(-3);
    // And still there while they keep standing, whatever the frame's alpha.
    views.sync(state(player(1, false), still), 1, 0.2);
    expect(mesh.position.asArray()).toEqual([7, 0.9, -3]);
    views.dispose();
  });
});

describe("EntityViews Hollows", () => {
  it("falls back to a near-black, lit, fog-free PBR capsule while there is no model", async () => {
    const views = new EntityViews(scene);
    const world = state();
    world.enemies.set(7, hollow(7, 1, 2, 0.5));
    views.sync(world, 99, 0);
    const mesh = scene.getMeshByName("hollow_7")!;
    expect(mesh).not.toBeNull();
    expect(scene.getMeshByName("enemy_7")).toBeNull();
    // A PBRMaterial, so the headlamp's 400 lights it on the same falloff as
    // the world; a StandardMaterial under that lamp blows out white.
    expect(mesh.material).toBeInstanceOf(PBRMaterial);
    const material = mesh.material as PBRMaterial;
    expect(material.name).toBe("mat_hollow");
    expect(material.fogEnabled).toBe(false);
    expect(material.disableLighting).toBe(false);
    expect(material.metallic).toBe(0);
    expect(material.roughness).toBe(1);
    expect(material.albedoColor.equals(new Color3(0.03, 0.03, 0.035))).toBe(true);
    expect(material.emissiveColor.equals(new Color3(0.006, 0.007, 0.009))).toBe(true);
    // The material readies for its capsule. NullEngine compiles no GLSL, so
    // this proves the material goes through Babylon's pipeline to a ready
    // effect, not that the shader links on a GPU; no material is ready
    // synchronously here, hence the forced compilation.
    await material.forceCompilationAsync(mesh);
    expect(material.isReady(mesh)).toBe(true);
    expect(mesh.rotation.y).toBeCloseTo(0.5, 9);
    // The hull centre is 0.9 m up; the 2.6 m capsule's centre sits 0.4 m higher so its feet meet the hull's.
    expect(mesh.position.y).toBeCloseTo(1.3, 6);
    views.dispose();
  });
});

/** The real GLBs, read from disk the way catalogModels.test.ts does. */
const fromDisk: CharacterLoader = (asset, s) => {
  registerBuiltInLoaders();
  const bytes = readFileSync(new URL(`../../assets/${asset.output}`, import.meta.url));
  return loadAssetContainerAsync(new Uint8Array(bytes), s, { pluginExtension: ".glb" });
};

/** Player 1 wears ranger.eric and player 2 ranger.sophia (ids 1 and 2 of the fixed five). */
async function loadedPool(): Promise<CharacterPool> {
  const pool = createCharacterPool(catalog, fromDisk);
  await pool.load(scene, ["ranger.eric", "ranger.sophia", "hollow.antlered"]);
  return pool;
}

function playing(prefix: string): { name: string; speedRatio: number }[] {
  return scene.animationGroups.filter((g) => g.name.startsWith(prefix) && g.isPlaying);
}

describe("EntityViews rangers", () => {
  it("draws a ranger for a remote player and nothing for the local one", async () => {
    const views = new EntityViews(scene, await loadedPool());
    views.sync(state(player(1, false), { ...player(2, false), pos: { x: 7, y: 0.9, z: -3 } }), 1, 1);
    const root = scene.getTransformNodeByName("character_2_orientation")!;
    expect(root).not.toBeNull();
    expect(root.isEnabled()).toBe(true);
    expect(scene.getTransformNodeByName("character_1_orientation")).toBeNull();
    // The model's origin is at its feet, 0.9 m under the hull's centre.
    expect(root.position.asArray()).toEqual([7, 0, -3]);
    // No capsule for a player who has a ranger.
    expect(scene.getMeshByName("player_2")).toBeNull();
    // The lamp stays at the eyes: feet + 0.9 + 0.7.
    const lamp = scene.lights.find((l) => l.name === "lamp_player_2") as SpotLight;
    expect(lamp.position.y).toBeCloseTo(1.6, 9);
    views.dispose();
  });

  it("turns the ranger to the player's yaw", async () => {
    const views = new EntityViews(scene, await loadedPool());
    views.sync(state(player(1, false), player(2, false, 1.2)), 1, 1);
    expect(scene.getTransformNodeByName("character_2_orientation")!.rotation.y).toBe(1.2);
    views.dispose();
  });

  it("walks above 0.3 m/s at speed ÷ 1.5, and stands at or below it", async () => {
    const views = new EntityViews(scene, await loadedPool());
    const at = (vx: number, vz: number) => ({ ...player(2, false), vel: { x: vx, y: -3, z: vz } });
    views.sync(state(player(1, false), at(0.3, 0)), 1, 1);
    expect(playing("character_2_").map((g) => g.name)).toEqual(["character_2_idle"]);
    expect(playing("character_2_")[0]!.speedRatio).toBe(1);
    // 1.8 and 2.4 horizontal is 3 m/s; the fall speed does not count.
    views.sync(state(player(1, false), at(1.8, 2.4)), 1, 1);
    expect(playing("character_2_").map((g) => g.name)).toEqual(["character_2_walk"]);
    expect(playing("character_2_")[0]!.speedRatio).toBeCloseTo(2, 9);
    // A slow shuffle and a sprint both stay inside [0.5, 2.5].
    views.sync(state(player(1, false), at(0.4, 0)), 1, 1);
    expect(playing("character_2_")[0]!.speedRatio).toBe(0.5);
    views.sync(state(player(1, false), at(0, 9)), 1, 1);
    expect(playing("character_2_")[0]!.speedRatio).toBe(2.5);
    views.dispose();
  });

  it("draws a capsule until the ranger loads, then hides it", async () => {
    const pool = createCharacterPool(catalog, fromDisk);
    const views = new EntityViews(scene, pool);
    views.sync(state(player(1, false), player(2, false)), 1, 1);
    const capsule = scene.getMeshByName("player_2")!;
    expect(capsule.isEnabled()).toBe(true);
    expect(scene.getTransformNodeByName("character_2_orientation")).toBeNull();
    await pool.load(scene, ["ranger.sophia"]);
    views.sync(state(player(1, false), player(2, false)), 1, 1);
    expect(capsule.isEnabled()).toBe(false);
    expect(scene.getTransformNodeByName("character_2_orientation")!.isEnabled()).toBe(true);
    views.dispose();
  });

  it("releases a ranger whose player left", async () => {
    const views = new EntityViews(scene, await loadedPool());
    views.sync(state(player(1, false), player(2, false)), 1, 1);
    const root = scene.getTransformNodeByName("character_2_orientation")!;
    views.sync(state(player(1, false)), 1, 1);
    expect(root.isDisposed()).toBe(true);
    views.dispose();
  });
});

describe("EntityViews the Hollow", () => {
  it("draws the antlered model at its feet, twice the model's size, with red eyes", async () => {
    const views = new EntityViews(scene, await loadedPool());
    const world = state();
    world.enemies.set(7, hollow(7, 1, 2, 0.5));
    views.sync(world, 99, 1);
    const root = scene.getTransformNodeByName("character_7_orientation") as TransformNode;
    expect(root).not.toBeNull();
    expect(scene.getMeshByName("hollow_7")).toBeNull();
    expect(root.position.asArray()).toEqual([1, 0, 2]);
    expect(root.scaling.asArray()).toEqual([2, 2, 2]);
    expect(root.rotation.y).toBe(0.5);
    const materials = new Set(root.getChildMeshes(false).flatMap((m) => (m.material === null ? [] : [m.material])));
    const eyes = [...materials].filter((m): m is PBRMaterial => m instanceof PBRMaterial && m.emissiveIntensity !== 1);
    expect(eyes).toHaveLength(1);
    expect(eyes[0]!.emissiveColor.equals(new Color3(1, 0.04, 0.02))).toBe(true);
    expect(eyes[0]!.emissiveIntensity).toBe(4);
    // The body keeps its own maps and takes the fog like any lit surface.
    for (const m of materials) {
      if (m === eyes[0]) continue;
      expect((m as PBRMaterial).fogEnabled).toBe(true);
      expect((m as PBRMaterial).emissiveColor.equals(new Color3(0, 0, 0))).toBe(true);
    }
    views.dispose();
  });

  it("walks at the pace it is measured to move, and stands when it stops", async () => {
    const views = new EntityViews(scene, await loadedPool());
    const world = state();
    world.enemies.set(7, hollow(7, 0, 0));
    views.sync(world, 99, 1, undefined, 1 / 30);
    expect(playing("character_7_").map((g) => g.name)).toEqual(["character_7_idle"]);
    // 0.1 m a frame at 30 frames a second is 3 m/s: two seconds of it
    // settles the smoothed pace, and 3 ÷ (1.5 × 2) is a walk at rate 1.
    for (let frame = 1; frame <= 60; frame++) {
      world.enemies.set(7, hollow(7, frame * 0.1, 0));
      views.sync(world, 99, 1, undefined, 1 / 30);
    }
    expect(playing("character_7_").map((g) => g.name)).toEqual(["character_7_walk"]);
    expect(playing("character_7_")[0]!.speedRatio).toBeCloseTo(1, 3);
    // Stopped, the pace decays under 0.3 m/s within the next second.
    for (let frame = 0; frame < 30; frame++) views.sync(world, 99, 1, undefined, 1 / 30);
    expect(playing("character_7_").map((g) => g.name)).toEqual(["character_7_idle"]);
    views.dispose();
  });
});
