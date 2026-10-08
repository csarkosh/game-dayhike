import { describe, it, expect } from "vitest";
import { SCENE_IN_S, SCENE_OUT_FROM_S, SCENE_OUT_S, SCENE_STAND_M, SCENE_EYE_HEIGHT, SCENE_PITCH, sceneStand, summitPose } from "../../src/game/cutscene.js";
import { SUMMIT_REVEAL_S } from "../../src/sim/hollow.js";

describe("the summit scene", () => {
  const base = { x: 10, y: 1.7, z: 0, yaw: Math.PI / 2, pitch: -0.1 };
  const body = { x: 0, y: 0.3, z: 0 };

  it("stands SCENE_STAND_M from the body toward where the eye was, crouched, looking at it", () => {
    const s = sceneStand(base, body);
    expect(Math.hypot(s.x - body.x, s.z - body.z)).toBeCloseTo(SCENE_STAND_M, 9);
    expect(s.x).toBeGreaterThan(0);
    expect(s.y).toBeCloseTo(body.y + SCENE_EYE_HEIGHT, 9);
    expect(s.pitch).toBe(SCENE_PITCH);
    // Facing the body: the yaw's direction points at it.
    expect(Math.sin(s.yaw) * (body.x - s.x) + Math.cos(s.yaw) * (body.z - s.z)).toBeGreaterThan(SCENE_STAND_M * 0.99);
  });

  it("begins at the eye, comes in over SCENE_IN_S, holds, and is back at the eye by the scene's end, inside the reveal", () => {
    expect(SCENE_OUT_FROM_S + SCENE_OUT_S).toBeLessThanOrEqual(SUMMIT_REVEAL_S);
    const at0 = summitPose(0, base, body);
    expect([at0.x, at0.y, at0.z, at0.yaw, at0.pitch]).toEqual([base.x, base.y, base.z, base.yaw, base.pitch]);
    const stand = sceneStand(base, body);
    const mid = summitPose(SCENE_IN_S / 2, base, body);
    expect(Math.hypot(mid.x - base.x, mid.z - base.z)).toBeGreaterThan(0);
    expect(Math.hypot(mid.x - stand.x, mid.z - stand.z)).toBeGreaterThan(0);
    const held = summitPose((SCENE_IN_S + SCENE_OUT_FROM_S) / 2, base, body);
    expect([held.x, held.y, held.z]).toEqual([stand.x, stand.y, stand.z]);
    const end = summitPose(SCENE_OUT_FROM_S + SCENE_OUT_S, base, body);
    expect(end.x).toBeCloseTo(base.x, 9);
    expect(end.z).toBeCloseTo(base.z, 9);
    expect(end.pitch).toBeCloseTo(base.pitch, 9);
  });
});
