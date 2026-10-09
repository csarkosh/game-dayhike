import { describe, it, expect } from "vitest";
import { BODY_TOP_M, CAP_SCENE_IN_S, CAP_SCENE_OUT_FROM_S, CAP_SCENE_OUT_S, CAP_SCENE_S, CAP_SCENE_STEP_M, capPose, capStand, HOLLOW_HEAD_M, LENS_24, LENS_32, LENS_GAME, SCENE_IN_S, SCENE_OUT_FROM_S, SCENE_OUT_S, SCENE_STAND_M, SCENE_EYE_HEIGHT, SCENE_PITCH, sceneStand, REVEAL_PAN_S, SCENE_LOOK_S, SCENE_TURN_S, SHOTS, shotAt, SUMMIT_RISE_AT_S, SUMMIT_SCENE_S, summitPose, summitShot, THRESHOLD_AT_S, thresholdAt, type SceneContext } from "../../src/game/cutscene.js";
import { SUMMIT_REVEAL_S } from "../../src/sim/hollow.js";
import { SUMMIT_RISE_DELAY_S } from "../../src/game/entityViews.js";

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

  it("the cap's scene steps toward the cap, turns to it and tips down at it, holds, and is back by its end", () => {
    const cap = { x: 3, y: 0.1, z: 2 };
    const eye = { x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0 };
    const s = capStand(eye, cap);
    expect(Math.hypot(s.x - eye.x, s.z - eye.z)).toBeCloseTo(CAP_SCENE_STEP_M, 9);
    expect(Math.sin(s.yaw) * (cap.x - s.x) + Math.cos(s.yaw) * (cap.z - s.z)).toBeGreaterThan(0);
    expect(s.pitch).toBeGreaterThan(0.3);
    expect(CAP_SCENE_S).toBe(CAP_SCENE_OUT_FROM_S + CAP_SCENE_OUT_S);
    const at0 = capPose(0, eye, cap);
    expect([at0.x, at0.yaw, at0.pitch]).toEqual([eye.x, eye.yaw, eye.pitch]);
    const held = capPose((CAP_SCENE_IN_S + CAP_SCENE_OUT_FROM_S) / 2, eye, cap);
    expect(held.yaw).toBeCloseTo(s.yaw, 9);
    const end = capPose(CAP_SCENE_S, eye, cap);
    expect(end.pitch).toBeCloseTo(eye.pitch, 9);
    expect(end.x).toBeCloseTo(eye.x, 9);
  });
});

describe("the summit's shots", () => {
  // The party came up the trail from -z: the body ahead of them, the Hollow 6 m past it.
  const ctx: SceneContext = {
    base: { x: 0, y: 1.6, z: -3.6, yaw: 0, pitch: 0.1 },
    body: { x: 0, y: 0, z: 0 },
    hollow: { x: 0, y: 0, z: 6 },
    party: { x: 0, y: 1.6, z: -3.6 },
  };
  const DOWN = (p: { pitch: number }) => p.pitch > 0;

  it("are five, their seconds the scene's, which is the Hollow's reveal", () => {
    expect(SHOTS).toHaveLength(5);
    expect(SUMMIT_SCENE_S).toBe(SHOTS.reduce((a, b) => a + b, 0));
    expect(SUMMIT_SCENE_S).toBe(SUMMIT_REVEAL_S);
    expect(shotAt(0)).toEqual({ shot: 0, into: 0 });
    expect(shotAt(SHOTS[0]! - 0.01).shot).toBe(0);
    expect(shotAt(SHOTS[0]!)).toEqual({ shot: 1, into: 0 });
    expect(shotAt(SUMMIT_SCENE_S - 0.5).shot).toBe(4);
    expect(shotAt(SUMMIT_SCENE_S + 5)).toEqual({ shot: 4, into: SHOTS[4] });
    expect(shotAt(-1)).toEqual({ shot: 0, into: 0 });
  });

  it("looks where it is told: yaw as the game's (+z is 0, +x a quarter turn), pitch down positive", () => {
    const ahead = summitShot(SHOTS[0]! + 2, ctx); // the find, from the party's side of the stake
    expect(ahead.z).toBeLessThan(0);
    expect(Math.abs(ahead.yaw)).toBeLessThan(0.5);
    const over = summitShot(SHOTS[0]! + SHOTS[1]! + SHOTS[2]! + 1, ctx); // the predator's view, past the Hollow, looking back
    expect(over.z).toBeGreaterThan(ctx.hollow.z);
    expect(Math.abs(Math.abs(over.yaw) - Math.PI)).toBeLessThan(0.6);
    expect(DOWN(over)).toBe(true);
  });

  it("the arrival is over the party's shoulder on a wide lens, behind their eye, the stake ahead", () => {
    const first = summitShot(0.5, ctx);
    expect(first.shot).toBe(0);
    expect(first.fov).toBe(LENS_24);
    expect(first.z).toBeLessThan(ctx.party.z);
    expect(first.y).toBeGreaterThan(ctx.party.y);
    const later = summitShot(SHOTS[0]! - 0.1, ctx);
    expect(later.z).toBeGreaterThan(first.z); // the push up the trail
  });

  it("the find tilts up the stake, from its foot to the hiker on it", () => {
    const t0 = SHOTS[0]!;
    const foot = summitShot(t0 + 0.01, ctx);
    const top = summitShot(t0 + SHOTS[1]! - 0.01, ctx);
    expect(foot.shot).toBe(1);
    expect(foot.fov).toBe(LENS_32);
    expect([foot.x, foot.y, foot.z]).toEqual([top.x, top.y, top.z]); // locked off, the tilt alone
    expect(foot.pitch).toBeGreaterThan(top.pitch);
    expect(top.pitch).toBeLessThan(0); // up, at BODY_TOP_M over the foot
    expect(BODY_TOP_M).toBeGreaterThan(3);
  });

  it("the reveal pans in its first beat from the hiker to the Hollow's spot, beside the stake on the widest lens, then climbs with the rise", () => {
    const t0 = SHOTS[0]! + SHOTS[1]!;
    const start = summitShot(t0 + 0.01, ctx);
    const spot = summitShot(t0 + REVEAL_PAN_S, ctx);
    const end = summitShot(t0 + SHOTS[2]! - 0.01, ctx);
    expect(start.fov).toBe(LENS_24);
    expect(start.y).toBeGreaterThan(ctx.body.y + 1); // over the ridge that hid the rise from the ground
    expect(Math.abs(start.yaw)).toBeGreaterThan(Math.PI / 4); // toward the stake beside it
    expect(Math.abs(spot.yaw)).toBeLessThan(Math.PI / 4); // toward the bare ground past it, before the rise
    expect(spot.pitch).toBeGreaterThan(-0.05); // level or down: nothing stands there yet
    expect([spot.x, spot.y, spot.z]).toEqual([end.x, end.y, end.z]); // locked off through the rise
    expect(end.pitch).toBeLessThan(spot.pitch); // up with it, to HOLLOW_HEAD_M
    expect(HOLLOW_HEAD_M).toBeGreaterThan(BODY_TOP_M);
    expect(SUMMIT_RISE_AT_S).toBe(t0 + REVEAL_PAN_S);
    expect(SUMMIT_RISE_DELAY_S).toBe(SUMMIT_RISE_AT_S);
  });

  it("the last shot is the player's own eye at the game's lens, live: the threshold", () => {
    const last = summitShot(SUMMIT_SCENE_S - 1, ctx);
    expect(last.shot).toBe(4);
    expect(last.fov).toBe(LENS_GAME);
    expect(last.live).toBe(true);
    expect(summitShot(1, ctx).live).toBe(false);
    expect(THRESHOLD_AT_S).toBe(SHOTS[0]! + SHOTS[1]! + SHOTS[2]! + SHOTS[3]!);
  });

  it("the threshold looks, then turns, then runs, each stage filling its seconds", () => {
    expect(thresholdAt(0)).toEqual({ stage: "look", f: 0 });
    expect(thresholdAt(SCENE_LOOK_S - 0.01).stage).toBe("look");
    const mid = thresholdAt(SCENE_LOOK_S + SCENE_TURN_S / 2);
    expect(mid.stage).toBe("turn");
    expect(mid.f).toBeGreaterThan(0.3);
    expect(mid.f).toBeLessThan(0.7);
    expect(thresholdAt(SCENE_LOOK_S + SCENE_TURN_S - 0.01).f).toBeGreaterThan(0.9);
    const run = thresholdAt(SCENE_LOOK_S + SCENE_TURN_S + 0.01);
    expect(run.stage).toBe("run");
    expect(thresholdAt(SHOTS[4]!).f).toBe(1);
    expect(SHOTS[4]!).toBeGreaterThan(SCENE_LOOK_S + SCENE_TURN_S + 1); // a second at least of running before the controls return
  });
});
