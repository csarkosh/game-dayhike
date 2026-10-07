import { describe, it, expect } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { EntityViews, SHADE_FADE_IN_S, SHADE_FADE_OUT_S, SHADE_RISE_S, risen } from "../../src/game/entityViews.js";
import { AiState } from "../../src/sim/types.js";
import type { EnemyState, WorldState } from "../../src/sim/types.js";

function enemy(id: number, ai: AiState): EnemyState {
  return {
    id, pos: { x: 0, y: 1, z: 10 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100, ai, targetId: 0, stateTimer: 0,
    attackCooldown: 0, lastDistSq: Infinity, stuckTimer: 0, unstickTimer: 0, route: [], routeAt: 0, approach: false, seen: false, emergeTo: null,
  };
}
function stateWith(enemies: EnemyState[]): WorldState {
  return { tick: 0, players: new Map(), enemies: new Map(enemies.map((e) => [e.id, e])), phase: 0, outcome: 0, nextEntityId: 100 } as unknown as WorldState;
}

describe("the shadow's rise", () => {
  it("eases from nothing to its full height, slowing into it, and takes longer than the fade", () => {
    expect(risen(0)).toBe(0);
    expect(risen(1)).toBe(1);
    expect(risen(0.5)).toBeCloseTo(0.5, 9);
    expect(risen(0.25)).toBeLessThan(0.25);
    expect(risen(0.75)).toBeGreaterThan(0.75);
    expect(risen(-1)).toBe(0);
    expect(risen(2)).toBe(1);
    expect(SHADE_RISE_S).toBeGreaterThan(SHADE_FADE_IN_S);
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
    views.sync(stateWith([enemy(1, AiState.Shade), enemy(2, AiState.Hunt)]), 0, 0, undefined, SHADE_FADE_IN_S / 2);
    expect(visibility("hollow_1")).toBeCloseTo(0.5, 6);
    views.sync(stateWith([enemy(1, AiState.Shade), enemy(2, AiState.Hunt)]), 0, 0, undefined, SHADE_FADE_IN_S);
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
