import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CATCH_AT_S } from "../../src/game/carAudio.js";
import { CAP_SCENE_S, LENS_24, LENS_32, SHOTS, SUMMIT_SCENE_S, THRESHOLD_AT_S, capPose, summitShot } from "../../src/game/cutscene.js";
import { DIED_CLOSE_FROM_S, DIED_CLOSE_S, DIED_FALL_S, DIED_ROLL, endingPose } from "../../src/game/ending.js";
import { DOOR_IN_M, END_ROAD_AT_S, HEADLAMP_UP, PULL_AWAY_AT_S, endCar } from "../../src/game/endScene.js";
import { createScenePlay, stareWithDark, type CarHandle, type PlayCamera, type PlayLocal, type ScenePlay } from "../../src/game/scenePlay.js";
import type { CarPose } from "../../src/game/scene/timeline.js";
import { PLAYER_EYE_OFFSET, PLAYER_HALF } from "../../src/sim/constants.js";
import { CAR_HALF } from "../../src/sim/trailhead.js";

type Place = { x: number; y: number; z: number };

/** A play with what it tells its renderer written down. */
function play(): { play: ScenePlay; staged: { pose: CarPose; car: CarHandle }[]; covers: number[] } {
  const staged: { pose: CarPose; car: CarHandle }[] = [];
  const covers: number[] = [];
  return { play: createScenePlay({ stage: (pose, car) => void staged.push({ pose: { ...pose }, car }), coverLeft: () => void covers.push(staged.length) }), staged, covers };
}

/** The player's own eye for a frame: where the camera comes in. */
const eye = (): PlayCamera => ({ x: 4, y: 1.7, z: -2, yaw: 0.3, pitch: -0.1, roll: 0.02 });
const local = (x = 4, z = -2): PlayLocal => ({ pos: { x, y: 0.9, z }, yaw: 0.25, pitch: -0.05 });
const nobody = new Map<number, { pos: Place; yaw: number }>();
const undrawn = (): Place | null => null;

/** A straight road along z on flat ground; the car on its shoulder at the pad, its nose to +z. */
const setup = (car: () => CarHandle | null, runner?: number) => ({
  site: { x: 6.9, z: 0 }, direction: 1 as const, road: { centerX: () => 0, groundY: () => 0 }, door: { x: 8.4, z: 0.5 }, car, ...(runner === undefined ? {} : { runner }),
});

describe("a hike with no scene", () => {
  it("leaves the camera the player's own, at the game's lens, the lamp on the lens and no body of their own in the frame", () => {
    const { play: p } = play();
    const camera = eye();
    const now = p.step(10, camera, local(), nobody, undrawn);
    expect(camera).toEqual(eye());
    expect(now).toMatchObject({ fov: null, showLocal: false, hideNear: null, lamp: "lens", lensDark: false, endRun: false });
    expect(p.endScene()).toBeNull();
    expect(p.runnerId()).toBeUndefined();
    expect([p.close, p.blur]).toEqual([0, 0]);
    const stare = { level: 0.3, phase: 0.4, sideX: 1, sideY: 0 };
    expect(p.shown(stare)).toBe(stare);
  });
});

describe("the summit's scene", () => {
  const body = { x: 0, y: 0.3, z: 0 };
  const more = { hollow: { x: -3, y: 0.2, z: 1 }, party: { x: 5, y: 1.7, z: -2 } };

  it("takes the camera through its shots from the eye of its first frame, shows the local body until the last, and hands the eye back there", () => {
    const { play: p } = play();
    p.setScene("summit", body, more, 0, 100);
    const first = eye();
    const now0 = p.step(100, first, local(), nobody, undrawn);
    // The base is the camera as it came in, with the player's own look.
    const ctx = { base: { x: 4, y: 1.7, z: -2, yaw: 0.25, pitch: -0.05 }, body, hollow: more.hollow, party: more.party };
    const shot0 = summitShot(0, ctx);
    expect(first).toEqual({ x: shot0.x, y: shot0.y, z: shot0.z, yaw: shot0.yaw, pitch: shot0.pitch, roll: 0 });
    expect(now0.fov).toBe(LENS_24);
    expect(now0.showLocal).toBe(true);
    expect(now0.lamp).toBe("body");
    expect(now0.lensDark).toBe(false);
    // Each cut: the first frame of the next shot is that shot's own camera and lens.
    let at = 0;
    for (let shot = 1; shot < SHOTS.length - 1; shot++) {
      at += SHOTS[shot - 1] as number;
      const camera = eye();
      const now = p.step(100 + at, camera, local(), nobody, undrawn);
      const want = summitShot(at, ctx);
      expect(want.shot).toBe(shot);
      expect(camera).toEqual({ x: want.x, y: want.y, z: want.z, yaw: want.yaw, pitch: want.pitch, roll: 0 });
      expect(now.fov).toBe(want.fov);
      expect(now.showLocal).toBe(true);
    }
    expect([summitShot(4, ctx).fov, summitShot(8, ctx).fov, summitShot(13, ctx).fov]).toEqual([LENS_32, LENS_24, LENS_32]);
    // The threshold is the player's own eye, bob and all, at the game's own lens: no body, the lamp on the lens.
    const live = eye();
    const last = p.step(100 + THRESHOLD_AT_S, live, local(), nobody, undrawn);
    expect(live).toEqual(eye());
    expect(last.fov).toBe(summitShot(THRESHOLD_AT_S, ctx).fov);
    expect(last.showLocal).toBe(false);
    expect(last.lamp).toBe("lens");
    // Past its length the scene is over: the game's lens again.
    const after = eye();
    expect(p.step(100 + SUMMIT_SCENE_S, after, local(), nobody, undrawn).fov).toBeNull();
    expect(after).toEqual(eye());
  });

  it("begun part-way plays from there: a return's threshold alone", () => {
    const { play: p } = play();
    p.setScene("summit", body, more, THRESHOLD_AT_S, 50);
    const camera = eye();
    const now = p.step(50, camera, local(), nobody, undrawn);
    expect(camera).toEqual(eye());
    expect(now.showLocal).toBe(false);
    expect(p.step(50 + (SHOTS[4] as number) - 0.01, eye(), local(), nobody, undrawn).fov).not.toBeNull();
    expect(p.step(50 + (SHOTS[4] as number), eye(), local(), nobody, undrawn).fov).toBeNull();
  });

  it("says in its own words when a scene begins and how a death's dark lifts", () => {
    const text = readFileSync(new URL("../../src/game/scenePlay.ts", import.meta.url), "utf8");
    expect(text).toContain("summitScene = { kind, since: seconds - fromS, base: null,");
    // The dark and the blur go over the seconds given, from what they were (ending.ts `liftShare`), not in one frame.
    expect(text).toMatch(/const share = liftShare\(seconds - lift\.since, lift\.forS\);\s*endClose = lift\.close \* share;\s*endBlur = lift\.blur \* share;/);
  });
});

describe("the cap's scene", () => {
  it("turns the camera to the cap at the game's lens, with no body shown, and gives it back", () => {
    const { play: p } = play();
    const cap = { x: 7, y: 0.1, z: 1 };
    p.setScene("cap", cap, undefined, 0, 0);
    const base = { x: 4, y: 1.7, z: -2, yaw: 0.25, pitch: -0.05 };
    for (const t of [0, 0.5, 2, CAP_SCENE_S - 0.2]) {
      const camera = eye();
      const now = p.step(t, camera, local(), nobody, undrawn);
      const want = capPose(t, base, cap);
      expect(camera).toEqual({ x: want.x, y: want.y, z: want.z, yaw: want.yaw, pitch: want.pitch, roll: 0 });
      expect(now).toMatchObject({ fov: null, showLocal: false, lamp: "lens", lensDark: false });
    }
    const after = eye();
    p.step(CAP_SCENE_S, after, local(), nobody, undrawn);
    expect(after).toEqual(eye());
  });
});

describe("the death", () => {
  it("takes the camera down from the pose of its first frame and closes the dark, which the pass reads a frame late", () => {
    const { play: p } = play();
    p.setEnding("died", undefined, 30);
    const camera = eye();
    p.step(30, camera, local(), nobody, undrawn);
    expect(camera).toEqual({ x: 4, y: 1.7, z: -2, yaw: 0.25, pitch: -0.05, roll: 0 });
    const base = { x: 4, y: 1.7, z: -2, yaw: 0.25, pitch: -0.05, feetY: 0.9 - PLAYER_HALF.y };
    const down = eye();
    p.step(30 + DIED_FALL_S, down, local(), nobody, undrawn);
    const want = endingPose("died", DIED_FALL_S, base);
    expect(down).toEqual({ x: want.x, y: want.y, z: want.z, yaw: want.yaw, pitch: want.pitch, roll: DIED_ROLL });
    expect(p.close).toBeCloseTo((DIED_FALL_S - DIED_CLOSE_FROM_S) / DIED_CLOSE_S, 12);
    expect(p.blur).toBe(0);
    // The stare's shade carries the dark: driven to it, from the side the death closes from.
    expect(p.shown({ level: 0.02, phase: 0.4, sideX: 1, sideY: 0 })).toEqual({ level: p.close, phase: 0.9, sideX: 1, sideY: 0 });
    expect(p.shown({ level: 0.9, phase: 0.4, sideX: 1, sideY: 0 }).level).toBe(0.9);
    // The same for a renderer that kept the dark of the frame before by itself.
    expect(stareWithDark({ level: 0.02, phase: 0.4, sideX: 1, sideY: 0 }, 0.5)).toEqual({ level: 0.5, phase: 0.9, sideX: 1, sideY: 0 });
    const rest = { level: 0.02, phase: 0.4, sideX: 1, sideY: 0 };
    expect(stareWithDark(rest, 0)).toBe(rest);
    p.step(30 + DIED_CLOSE_FROM_S + DIED_CLOSE_S, eye(), local(), nobody, undrawn);
    expect(p.close).toBe(1);
    // A second word of it changes nothing.
    p.setEnding("died", undefined, 99);
    const still = eye();
    p.step(40, still, local(), nobody, undrawn);
    expect(still.roll).toBe(DIED_ROLL);
  });

  it("takes the camera from a scene, which does not run under it", () => {
    const { play: p } = play();
    p.setScene("cap", { x: 7, y: 0.1, z: 1 }, undefined, 0, 10);
    p.setEnding("died", undefined, 10);
    const camera = eye();
    const now = p.step(10, camera, local(), nobody, undrawn);
    // The pose of the death's first frame is the player's own eye, not the cap's turn.
    expect([camera.x, camera.y, camera.z]).toEqual([4, 1.7, -2]);
    expect(now.fov).toBeNull();
  });

  it("undone, gives the camera back at once and lifts its dark evenly over the seconds given", () => {
    const { play: p } = play();
    p.setEnding("died", undefined, 0);
    p.step(0, eye(), local(), nobody, undrawn);
    p.step(DIED_CLOSE_FROM_S + DIED_CLOSE_S / 2, eye(), local(), nobody, undrawn);
    expect(p.close).toBeCloseTo(0.5, 12);
    p.clearEnding(1.2, 10);
    const camera = eye();
    p.step(10, camera, local(), nobody, undrawn);
    expect(camera).toEqual(eye());
    expect(p.close).toBeCloseTo(0.5, 12);
    p.step(10.6, eye(), local(), nobody, undrawn);
    expect(p.close).toBeCloseTo(0.25, 12);
    p.step(11.3, eye(), local(), nobody, undrawn);
    expect(p.close).toBe(0);
    // A scene's camera runs again after it.
    p.setScene("cap", { x: 7, y: 0.1, z: 1 }, undefined, 0, 12);
    const turned = eye();
    p.step(12.5, turned, local(), nobody, undrawn);
    expect(turned).not.toEqual(eye());
  });

  it("undone with no seconds given, is gone at once; and a death may come again", () => {
    const { play: p } = play();
    p.setEnding("died", undefined, 0);
    p.step(0, eye(), local(), nobody, undrawn);
    p.step(DIED_CLOSE_FROM_S + DIED_CLOSE_S, eye(), local(), nobody, undrawn);
    expect(p.close).toBe(1);
    p.clearEnding(0, 5);
    expect(p.close).toBe(0);
    p.setEnding("died", undefined, 6);
    p.step(6 + DIED_CLOSE_FROM_S + DIED_CLOSE_S, eye(), local(), nobody, undrawn);
    expect(p.close).toBe(1);
  });
});

describe("the end scene", () => {
  it("films the run, puts the runner in the car at the door, drives it, takes it out of the rain's cover once and lights its lamps at the catch", () => {
    const { play: p, staged, covers } = play();
    let left = 0;
    const lit: boolean[] = [];
    const car: CarHandle = { leave: () => void (left += 1), tailLamps: (on) => void lit.push(on) };
    p.setEnding("won", setup(() => car), 5);
    expect(p.endScene()).toEqual({ t: 0, arrival: null, shot: 0, car: { x: 6.9, y: 0, z: 0, yaw: 0, speed: 0 } });
    // Shot 1: behind the runner and to their right, over their eye, at the door, on the 24 mm.
    const run = eye();
    const now = p.step(5, run, local(20, 10), nobody, undrawn);
    expect(run.x).toBeCloseTo(21.321891583212775, 9);
    expect(run.y).toBeCloseTo(0.9 + PLAYER_EYE_OFFSET + 0.5, 9);
    expect(run.z).toBeCloseTo(11.858118037755196, 9);
    expect(run.yaw).toBeCloseTo(-2.291877519079126, 9);
    expect(run.roll).toBe(0);
    expect(now).toMatchObject({ fov: LENS_24, showLocal: true, lamp: "body", lensDark: true, endRun: true, hideNear: { x: 8.4, z: 0.5, radius: DOOR_IN_M } });
    // The car is staged parked from the first frame.
    expect(staged).toHaveLength(1);
    expect(staged[0]!.car).toBe(car);
    expect([staged[0]!.pose.x, staged[0]!.pose.z, staged[0]!.pose.yaw, staged[0]!.pose.wheelSpin]).toEqual([6.9, 0, 0, 0]);
    // At the door a second later: in the car, the engine's shot from the far shoulder, the lamp dark.
    const engine = eye();
    const inCar = p.step(6, engine, local(8.4, 0.5), nobody, undrawn);
    expect(p.endScene()).toMatchObject({ arrival: 1, shot: 2 });
    expect([engine.x, engine.y, engine.z]).toEqual([-6.9, 0.6, 7]);
    expect(inCar).toMatchObject({ fov: LENS_32, showLocal: false, lamp: "lens", lensDark: true });
    expect(lit).toEqual([]);
    // Pulled away, 1.75 m on, still over its own footprint: still the rain's cover.
    p.step(9.6, eye(), local(8.4, 0.5), nobody, undrawn);
    expect(p.endScene()!.car.z).toBeCloseTo(1.75, 9);
    expect([left, covers.length]).toEqual([0, 0]);
    // 4.6 s after the arrival: 7 m down the road, clear of its footprint, and past the catch.
    expect(PULL_AWAY_AT_S + 2).toBeGreaterThan(CATCH_AT_S);
    const road = eye();
    const driven = p.step(10.6, road, local(8.4, 0.5), nobody, undrawn);
    const pose = endCar(4.6, setup(() => car).road, { x: 6.9, z: 0 }, 1);
    expect(p.endScene()!.car).toMatchObject({ x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw });
    expect(p.endScene()!.car.speed).toBeCloseTo(7, 9);
    expect(pose.z).toBeCloseTo(7, 9);
    expect(staged[staged.length - 1]!.pose).toEqual(pose);
    expect(left).toBe(1);
    // The cover is drawn again after the frame's staging, once.
    expect(covers).toEqual([staged.length]);
    expect(lit).toEqual([true]);
    // The headlamp is at the nose of the car as posed this frame.
    expect(driven.lamp).toBe("car");
    expect(driven.carLamp.x).toBeCloseTo(pose.x + CAR_HALF.z * Math.sin(pose.yaw), 12);
    expect(driven.carLamp.y).toBeCloseTo(pose.y + HEADLAMP_UP, 12);
    expect(driven.carLamp.z).toBeCloseTo(pose.z + CAR_HALF.z * Math.cos(pose.yaw), 12);
    p.step(10.7, eye(), local(8.4, 0.5), nobody, undrawn);
    expect([left, covers.length, lit.length]).toEqual([1, 1, 1]);
    // The road's shot, from over the car.
    p.step(6 + END_ROAD_AT_S, eye(), local(8.4, 0.5), nobody, undrawn);
    expect(p.endScene()!.shot).toBe(3);
    // A second end changes nothing.
    p.setEnding("won", setup(() => null), 50);
    expect(p.endScene()!.arrival).toBe(1);
  });

  it("keeps the lamp at the parked car when there is no car drawn to drive, and stages none", () => {
    const { play: p, staged } = play();
    p.setEnding("won", setup(() => null), 5);
    p.step(5, eye(), local(8.4, 0.5), nobody, undrawn);
    const now = p.step(9.6, eye(), local(8.4, 0.5), nobody, undrawn);
    // The sound's car is down the road; the lamp stands at the middle of the parked car's nose.
    expect(p.endScene()!.car.z).toBeGreaterThan(1);
    expect(now.lamp).toBe("car");
    expect([now.carLamp.x, now.carLamp.y, now.carLamp.z]).toEqual([6.9, 0.7, 2.3]);
    expect(staged).toEqual([]);
  });

  it("on another player's run is stepped on them, drawn where their body is, judged by where they are, with this screen's own body left out", () => {
    const { play: p } = play();
    p.setEnding("won", setup(() => null, 7), 5);
    expect(p.runnerId()).toBe(7);
    const other = { pos: { x: 20, y: 5.9, z: 10 }, yaw: 1.1 };
    const players = new Map([[7, other]]);
    const camera = eye();
    const now = p.step(5, camera, local(400, 900), players, (id) => (id === 7 ? { x: 19, y: 5, z: 9.5 } : null));
    expect(now.showLocal).toBe(false);
    // The run's camera rides the body as drawn, not this screen's player a kilometre off.
    expect(Math.hypot(camera.x - 19, camera.z - 9.5)).toBeLessThan(3);
    expect(camera.y).toBeCloseTo(5 + PLAYER_HALF.y + PLAYER_EYE_OFFSET + 0.5, 9);
    expect(p.endScene()!.arrival).toBeNull();
    // Their own place is at the door, though their body is drawn short of it.
    other.pos = { x: 8.4, y: 0.9, z: 0.5 };
    p.step(6, eye(), local(400, 900), players, () => ({ x: 9.4, y: 0, z: 1.5 }));
    expect(p.endScene()!.arrival).toBe(1);
    const text = readFileSync(new URL("../../src/game/scenePlay.ts", import.meta.url), "utf8");
    expect(text).toContain("if (ctx.arrival === null && arrived(runner.at, ctx.door, t)) ctx.arrival = t;");
    expect(text).toContain("now.showLocal = ctx.arrival === null && e.setup.runner === undefined;");
  });

  it("is not set without what it is played over, and leaves a death to its own ending", () => {
    const { play: p } = play();
    p.setEnding("won", undefined, 5);
    expect(p.endScene()).toBeNull();
    p.setEnding("won", setup(() => null), 0);
    p.setEnding("died", undefined, 0);
    const camera = eye();
    p.step(DIED_FALL_S, camera, local(), nobody, undrawn);
    // The death has the camera over the end scene's.
    expect(camera.roll).toBe(DIED_ROLL);
    p.clearEnding(0, 8);
    const back = eye();
    const now = p.step(8, back, local(), nobody, undrawn);
    // The won scene is left as it is.
    expect(now.endRun).toBe(true);
    expect(back.roll).toBe(0);
  });
});

describe("the two renderers", () => {
  it("both step the one play and set its camera, its lens and its body", () => {
    const babylon = readFileSync(new URL("../../src/game/renderer.ts", import.meta.url), "utf8");
    for (const piece of [
      "const now = play.step(seconds, playCamera, local, state.players, (id) => views.drawnAt(id));",
      "views.showLocal = now.showLocal;", "views.hideNear = now.hideNear;", "camera.fov = now.fov ?? GAME_FOV;",
      "rainMap?.update(now.endRun ? camera.position : local.pos);", "const shown = play.shown(stareLens);",
      "play.setScene(kind, at, more, fromS, clock() / 1000);", "play.clearEnding(liftS, clock() / 1000);", "play.setEnding(kind, scene, clock() / 1000);",
    ]) expect(babylon).toContain(piece);
  });
});
