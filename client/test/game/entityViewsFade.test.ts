import { describe, it, expect } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { EntityViews, LUNGE_FADE_IN_S, SHADE_EYES_FROM, SHADE_FADE_IN_S, SHADE_FADE_OUT_S, SUMMIT_RISE_DELAY_S, eyeLevelOf, opacityOf } from "../../src/game/entityViews.js";
import { AiState, Phase } from "../../src/sim/types.js";
import type { EnemyState, WorldState } from "../../src/sim/types.js";

function enemy(id: number, ai: AiState): EnemyState {
  return {
    id, pos: { x: 0, y: 1, z: 10 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100, ai, targetId: 0, stateTimer: 0,
    attackCooldown: 0, lastDistSq: Infinity, stuckTimer: 0, unstickTimer: 0, route: [], routeAt: 0, approach: false, seen: false, emergeTo: null,
  };
}
function stateWith(enemies: EnemyState[], phase: Phase = Phase.Climb): WorldState {
  return { tick: 0, players: new Map(), enemies: new Map(enemies.map((e) => [e.id, e])), phase, outcome: 0, nextEntityId: 100 } as unknown as WorldState;
}

describe("the smoke's coming and going", () => {
  it("brings a figure in over 2.4 s at its whole height (a lunge over 1.2 s) and takes it out over 2.6 s, its opacity whole a third of the way in, its eyes last", () => {
    expect(SHADE_FADE_IN_S).toBe(2.4);
    expect(LUNGE_FADE_IN_S).toBe(1.2);
    expect(SHADE_FADE_OUT_S).toBe(2.6);
    expect(opacityOf(0)).toBe(0);
    expect(opacityOf(0.1)).toBeCloseTo(0.3, 9);
    expect(opacityOf(0.34)).toBe(1);
    expect(opacityOf(1)).toBe(1);
    // The eyes come with the head, from SHADE_EYES_FROM of the way in, and go first.
    expect(SHADE_EYES_FROM).toBe(0.7);
    expect(eyeLevelOf(0, 0.7)).toBe(0);
    expect(eyeLevelOf(0, 0.85)).toBeCloseTo(0.06875, 9);
    expect(eyeLevelOf(0, 1)).toBeCloseTo(0.1375, 9);
    expect(eyeLevelOf(1, 1)).toBeCloseTo(0.00125, 9);
  });
});

describe("the lunge's coming", () => {
  it("comes in over LUNGE_FADE_IN_S, half a shade's time", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const views = new EntityViews(scene);
    const visibility = (name: string) => {
      const m = scene.getMeshByName(name);
      return m === undefined || m === null ? null : m.visibility;
    };
    views.sync(stateWith([enemy(1, AiState.Lunge)]), 0, 0, undefined, 0);
    expect(visibility("hollow_1")).toBe(0);
    views.sync(stateWith([enemy(1, AiState.Lunge)]), 0, 0, undefined, LUNGE_FADE_IN_S / 2);
    expect(visibility("hollow_1")).toBeCloseTo(0.5, 6);
    views.sync(stateWith([enemy(1, AiState.Lunge)]), 0, 0, undefined, LUNGE_FADE_IN_S / 2);
    expect(visibility("hollow_1")).toBe(1);
    views.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("the shadow's look", () => {
  it("brings a shade in from nothing over SHADE_FADE_IN_S, a Hollow at once, and holds a gone shade while it goes out over SHADE_FADE_OUT_S", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const views = new EntityViews(scene);
    const visibility = (name: string) => {
      const m = scene.meshes.find((mesh) => mesh.name === name);
      return m === undefined ? null : m.visibility;
    };
    // No model in the pool under NullEngine: the fallback capsules are drawn.
    views.sync(stateWith([enemy(1, AiState.Shade), enemy(2, AiState.Hunt)]), 0, 0, undefined, 0);
    expect(visibility("hollow_1")).toBe(0);
    expect(visibility("hollow_2")).toBe(1);
    // Half in half way, whole at SHADE_FADE_IN_S: the smoke brings it, never a growing.
    views.sync(stateWith([enemy(1, AiState.Shade), enemy(2, AiState.Hunt)]), 0, 0, undefined, SHADE_FADE_IN_S / 2);
    expect(visibility("hollow_1")).toBeCloseTo(0.5, 6);
    views.sync(stateWith([enemy(1, AiState.Shade), enemy(2, AiState.Hunt)]), 0, 0, undefined, SHADE_FADE_IN_S / 2);
    expect(visibility("hollow_1")).toBe(1);
    // Gone from the state: the capsule view is pruned at once (the held fade is the model's), and a Hollow likewise.
    views.sync(stateWith([]), 0, 0, undefined, 0.1);
    expect(views.fadingOut()).toBe(0);
    expect(visibility("hollow_1")).toBeNull();
    expect(SHADE_FADE_OUT_S).toBeGreaterThan(0);
    views.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe("a Hollow stepping out", () => {
  it("comes in at once in the chase (a fork's), and waits SUMMIT_RISE_DELAY_S in the summit scene (the summit's)", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const visibility = (s: Scene, name: string) => s.meshes.find((mesh) => mesh.name === name)?.visibility ?? null;
    const chase = new EntityViews(scene);
    chase.sync(stateWith([enemy(1, AiState.Emerge)], Phase.Chase), 0, 0, undefined, 0);
    chase.sync(stateWith([enemy(1, AiState.Emerge)], Phase.Chase), 0, 0, undefined, SHADE_FADE_IN_S / 4);
    expect(visibility(scene, "hollow_1")).toBeCloseTo(0.25, 6);
    chase.dispose();
    const scene2 = new Scene(engine);
    const summit = new EntityViews(scene2);
    summit.sync(stateWith([enemy(1, AiState.Emerge)], Phase.Scene), 0, 0, undefined, 0);
    summit.sync(stateWith([enemy(1, AiState.Emerge)], Phase.Scene), 0, 0, undefined, SUMMIT_RISE_DELAY_S - 0.1);
    expect(visibility(scene2, "hollow_1")).toBe(0);
    summit.sync(stateWith([enemy(1, AiState.Emerge)], Phase.Scene), 0, 0, undefined, 0.1 + SHADE_FADE_IN_S / 4);
    expect(visibility(scene2, "hollow_1")).toBeCloseTo(0.25, 6);
    summit.dispose();
  });
});
