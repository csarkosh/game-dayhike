import { describe, expect, it } from "vitest";
import { ENEMY_HALF, PLAYER_EYE_OFFSET, PLAYER_HALF, TELEPORT_M } from "../../src/sim/constants.js";
import { HOLLOW_HEIGHT } from "../../src/sim/hollow.js";
import { AiState, Outcome, Phase, type EnemyState, type PlayerState, type WorldState } from "../../src/sim/types.js";
import {
  HOLLOW_MAX_MEASURED_SPEED, RANGER_IDS, REACH_S, SHADE_FADE_IN_S, SHADE_FADE_OUT_S, WALK_RATIO_MAX, WALK_RATIO_MIN, WALK_THRESHOLD,
  advanceTrack, createEntityPoses, eyeLevelOf, opacityOf, placeTrack, stepClip, strideFor, type EntityModels,
} from "../../src/game/entityPoses.js";
import { HOLLOW_SCALE, HOLLOW_WALK_CLIP_SPEED, RANGER_WALK_CLIP_SPEED } from "../../src/game/hollowLook.js";

function player(id: number, x = id, z = 0): PlayerState {
  return {
    id, pos: { x, y: 0.9, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0.5, pitch: 0, health: 100, grounded: true, lastProcessedInput: 0,
    deathPos: null, killedBy: 0, returnIn: 0, heldFor: 0, out: false, cause: 0, lamp: { on: id % 2 === 0, charge: 1 }, stare: 0, safe: false,
  };
}
function hollow(id: number, x: number, z: number, ai: AiState = AiState.Stand): EnemyState {
  return {
    id, pos: { x, y: 0.9, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0.25, health: 40, ai,
    targetId: 0, stateTimer: 0, attackCooldown: 0, lastDistSq: Infinity, stuckTimer: 0, unstickTimer: 0,
    route: [], routeAt: 0, approach: false, seen: false, emergeTo: null, stalks: false, fork: -1, forkEdge: -1,
  };
}
function state(players: PlayerState[], enemies: EnemyState[] = [], phase: Phase = Phase.Climb): WorldState {
  return {
    tick: 1, players: new Map(players.map((p) => [p.id, p])), enemies: new Map(enemies.map((e) => [e.id, e])),
    outcome: Outcome.Playing, phase, nextEntityId: 100, rngSeed: 1,
  };
}
const MODELS: EntityModels = { player: () => true, hollow: () => true };
const CAPSULES: EntityModels = { player: () => false, hollow: () => false };

describe("a track between ticks", () => {
  it("is drawn where it was placed until it moves, then between its last two places", () => {
    const track = placeTrack(3, 1, 4);
    advanceTrack(track, 3, 1, 4, 0.25);
    expect([track.x, track.y, track.z]).toEqual([3, 1, 4]);
    advanceTrack(track, 5, 1, 4, 0.25);
    expect([track.x, track.y, track.z]).toEqual([3.5, 1, 4]);
    advanceTrack(track, 5, 1, 4, 1);
    expect(track.x).toBe(5);
  });

  it("draws a jump no walk makes where it lands", () => {
    const track = placeTrack(0, 0, 0);
    advanceTrack(track, TELEPORT_M + 1, 0, 0, 0.1);
    expect(track.x).toBe(TELEPORT_M + 1);
    const walked = placeTrack(0, 0, 0);
    advanceTrack(walked, TELEPORT_M - 1, 0, 0, 0.5);
    expect(walked.x).toBe((TELEPORT_M - 1) / 2);
  });
});

describe("a stride", () => {
  it("stands at or below the threshold and walks above it at speed over the clip's, held to the range", () => {
    const out = { clip: "walk" as const, rate: 9 };
    expect(strideFor(WALK_THRESHOLD, 1.5, out)).toEqual({ clip: "idle", rate: 1 });
    expect(strideFor(3, 1.5, out)).toEqual({ clip: "walk", rate: 2 });
    expect(strideFor(0.31, 1.5, out).rate).toBe(WALK_RATIO_MIN);
    expect(strideFor(30, 1.5, out).rate).toBe(WALK_RATIO_MAX);
  });

  it("counts a clip's time from its start, at its rate, and keeps the rate where none is given", () => {
    const clock = { clip: "idle", seconds: 4, rate: 1 };
    stepClip(clock, "idle", 1, 0.5);
    expect(clock.seconds).toBe(4.5);
    stepClip(clock, "walk", 2, 0.25);
    expect(clock).toEqual({ clip: "walk", seconds: 0.5, rate: 2 });
    stepClip(clock, "idle", null, 0.25);
    expect(clock).toEqual({ clip: "idle", seconds: 0.5, rate: 2 });
  });
});

describe("the hikers in a frame", () => {
  it("hides the local player as the lens and stands every other on its model's feet, turned, its eyes over them, its lamp as the player's", () => {
    const poses = createEntityPoses();
    const frame = poses.step(state([player(1), player(2), player(3)]), 1, 1, 0, MODELS);
    expect(frame.players.map((p) => [p.id, p.hidden, p.local])).toEqual([[1, "lens", true], [2, null, false], [3, null, false]]);
    const two = frame.players[1]!;
    expect(two.model).toBe(RANGER_IDS[2]);
    expect(two.modelled).toBe(true);
    expect([two.x, two.y, two.z]).toEqual([2, 0.9 - PLAYER_HALF.y, 0]);
    expect(two.yaw).toBe(0.5);
    expect(two.eyeY).toBeCloseTo(0.9 + PLAYER_EYE_OFFSET, 12);
    expect(two.lampOn).toBe(true);
    expect(frame.players[2]!.lampOn).toBe(false);
    expect(Math.hypot(two.aimX, two.aimY, two.aimZ)).toBeCloseTo(1, 12);
    expect(poses.drawnAt(2)).toEqual({ x: 2, y: 0.9 - PLAYER_HALF.y, z: 0 });
    expect(poses.drawnAt(1)).toBeNull();
  });

  it("stands a body with no model on its capsule's middle, the eyes at the same height", () => {
    const poses = createEntityPoses();
    const pose = poses.step(state([player(1), player(2)]), 1, 1, 0, CAPSULES).players[1]!;
    expect(pose.modelled).toBe(false);
    expect(pose.y).toBe(0.9);
    expect(pose.eyeY).toBeCloseTo(0.9 + PLAYER_EYE_OFFSET, 12);
    expect(poses.drawnAt(2)).toEqual({ x: 2, y: 0.9 - PLAYER_HALF.y, z: 0 });
  });

  it("draws the local body in a scene, and hides another within the car's radius", () => {
    const poses = createEntityPoses();
    poses.showLocal = true;
    poses.hideNear = { x: 2, z: 0, radius: 1.2 };
    const frame = poses.step(state([player(1), player(2), player(4)]), 1, 1, 0, MODELS);
    expect(frame.players.map((p) => p.hidden)).toEqual([null, "car", null]);
  });

  it("walks a hiker at their speed over the clip's and says who has gone", () => {
    const poses = createEntityPoses();
    const walker = player(2);
    walker.vel.x = 3;
    const first = poses.step(state([player(1), walker, player(3)]), 1, 1, 0, { player: (id) => id === 2, hollow: () => false });
    expect([first.players[1]!.clip, first.players[1]!.rate]).toEqual(["walk", 3 / RANGER_WALK_CLIP_SPEED]);
    const next = poses.step(state([player(1)]), 1, 1, 0, MODELS);
    expect([...next.playersGone]).toEqual([2]);
    expect([...next.capsulesGone]).toEqual([3]);
    expect(poses.drawnAt(2)).toBeNull();
  });

  it("keeps a model's track a renderer placed for itself until it is forgotten", () => {
    const poses = createEntityPoses();
    const track = poses.modelTrack(1, 1, -40, 0);
    expect(poses.modelTrack(1, 9, 9, 9)).toBe(track);
    expect(poses.drawnAt(1)).toEqual({ x: 1, y: -40, z: 0 });
    poses.forgetModel(1);
    expect(poses.drawnAt(1)).toBeNull();
  });
});

describe("the Hollows in a frame", () => {
  it("stands a Hollow at once on its feet, turned to the local player, whole in the mask and resolved", () => {
    const poses = createEntityPoses();
    const pose = poses.step(state([player(1, 0, 0)], [hollow(7, 3, 4)]), 1, 1, 0, MODELS).hollows[0]!;
    expect(pose.modelled).toBe(true);
    expect([pose.x, pose.y, pose.z]).toEqual([3, 0.9 - ENEMY_HALF.y, 4]);
    expect(pose.yaw).toBeCloseTo(Math.atan2(-3, -4), 12);
    expect(pose.level).toBe(1);
    expect(pose.shade).toEqual({ fade: 1, presence: 1, soft: 0, near: 1, eyeLevel: eyeLevelOf(0, 1) });
  });

  it("keeps the simulation's yaw with no local player, and lifts a capsule to stand on the same feet", () => {
    const poses = createEntityPoses();
    const pose = poses.step(state([], [hollow(7, 3, 4)]), 1, 1, 0, CAPSULES).hollows[0]!;
    expect(pose.yaw).toBe(0.25);
    expect(pose.modelled).toBe(false);
    expect(pose.y).toBe(0.9 - ENEMY_HALF.y + HOLLOW_HEIGHT / 2);
  });

  it("brings a shade in from nothing, soft, and takes it out where it stood once it is gone", () => {
    const poses = createEntityPoses();
    const world = state([player(1, 0, 0)], [hollow(7, 3, 4, AiState.Shade)]);
    expect(poses.step(world, 1, 1, 0, MODELS).hollows[0]!.level).toBe(0);
    const half = poses.step(world, 1, 1, SHADE_FADE_IN_S / 2, MODELS).hollows[0]!;
    expect(half.level).toBeCloseTo(0.5, 12);
    expect(half.shade.fade).toBe(opacityOf(half.level));
    expect(half.shade.soft).toBe(1);
    const gone = poses.step(state([player(1, 0, 0)]), 1, 1, 0, MODELS);
    expect(gone.hollows.length).toBe(0);
    expect(gone.fading.map((f) => [f.id, f.x, f.z])).toEqual([[7, 3, 4]]);
    expect([...gone.hollowsGone]).toEqual([]);
    expect(poses.fadingOut()).toBe(1);
    const out = poses.step(state([player(1, 0, 0)]), 1, 1, SHADE_FADE_OUT_S, MODELS);
    expect(out.fading.length).toBe(0);
    expect([...out.hollowsGone]).toEqual([7]);
    expect(poses.fadingOut()).toBe(0);
  });

  it("lets a Hollow that is not a shade go at once", () => {
    const poses = createEntityPoses();
    poses.step(state([player(1)], [hollow(7, 3, 4), hollow(8, 5, 5)]), 1, 1, 0, { player: () => true, hollow: (id) => id === 7 });
    const gone = poses.step(state([player(1)]), 1, 1, 0.1, MODELS);
    expect([...gone.hollowsGone]).toEqual([7]);
    expect([...gone.hollowCapsulesGone]).toEqual([8]);
    expect(gone.fading.length).toBe(0);
  });

  it("waits out the summit scene's first shots before a Hollow stepping out comes in, and not in the chase", () => {
    const scene = createEntityPoses();
    const stepping = [hollow(7, 3, 4, AiState.Emerge)];
    scene.step(state([player(1)], stepping, Phase.Scene), 1, 1, 0, MODELS);
    expect(scene.step(state([player(1)], stepping, Phase.Scene), 1, 1, 1, MODELS).hollows[0]!.level).toBe(0);
    const chase = createEntityPoses();
    chase.step(state([player(1)], stepping), 1, 1, 0, MODELS);
    expect(chase.step(state([player(1)], stepping), 1, 1, 1, MODELS).hollows[0]!.level).toBeCloseTo(1 / SHADE_FADE_IN_S, 12);
  });

  it("measures a Hollow's pace from how far it is drawn to move, a jump counted for no more than the cap", () => {
    const poses = createEntityPoses();
    const walker = hollow(7, 0, 50);
    poses.step(state([player(1, 0, 0)], [walker]), 1, 1, 0, MODELS);
    walker.pos.z = 46;
    const pose = poses.step(state([player(1, 0, 0)], [walker]), 1, 1, 1, MODELS).hollows[0]!;
    expect(pose.clip).toBe("walk");
    const speed = 4 * (1 - Math.exp(-1 / 0.25));
    expect(pose.rate).toBeCloseTo(speed / (HOLLOW_WALK_CLIP_SPEED * HOLLOW_SCALE), 12);
    const jumper = createEntityPoses();
    const far = hollow(8, 0, 90);
    jumper.step(state([player(1, 0, 0)], [far]), 1, 1, 0, MODELS);
    far.pos.z = 30;
    const jumped = jumper.step(state([player(1, 0, 0)], [far]), 1, 1, 0.001, MODELS).hollows[0]!;
    expect(jumped.rate as number).toBeLessThanOrEqual(HOLLOW_MAX_MEASURED_SPEED / (HOLLOW_WALK_CLIP_SPEED * HOLLOW_SCALE));
  });

  it("stands a strike in the idle at the rate it had and turns its arms out over the reach's time, at the local player's eyes", () => {
    const poses = createEntityPoses();
    const world = state([player(1, 0, 0)], [hollow(7, 0, 2, AiState.Strike)]);
    const first = poses.step(world, 1, 1, REACH_S / 2, MODELS);
    expect([first.hollows[0]!.clip, first.hollows[0]!.rate]).toEqual(["idle", null]);
    expect(first.hollows[0]!.reach).toBeCloseTo(0.5, 12);
    expect(first.reachAt).toEqual({ x: 0, y: 0.9 + PLAYER_EYE_OFFSET, z: 0 });
    expect(poses.step(world, 1, 1, REACH_S, MODELS).hollows[0]!.reach).toBe(1);
    expect(poses.reaches().get(7)).toBe(1);
  });
});
