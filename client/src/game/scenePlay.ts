/**
 * The scenes and the endings as a hike's renderer plays them, with no
 * engine: which of them has the frame, where its camera stands and through
 * what lens, whether the local hiker's own body is in the shot, who is in
 * the car, where the one lamp is worn, how far a death's dark has closed,
 * and where the end scene's car is. The shots themselves are arithmetic
 * (`cutscene.ts`, `ending.ts`, `endScene.ts`); this is the state that runs
 * from frame to frame between them, and the order they take the camera in.
 * The hike's renderer steps it once a frame, after the player's own eye is
 * placed, and draws what it says.
 *
 * A frame's order, each later one taking the camera from the one before:
 * the summit's scene or the cap's, while neither ending has begun; the end
 * scene (the match won), from the frame it is set; the death, from its
 * first frame, over either. A death undone (`clearEnding`) gives the camera
 * back at once and lifts its dark over the seconds it is given.
 *
 * Loads no engine.
 */
import { PLAYER_EYE_OFFSET, PLAYER_HALF } from "../sim/constants.js";
import { CAR_HALF } from "../sim/trailhead.js";
import { CATCH_AT_S } from "./carAudio.js";
import { CAP_SCENE_S, SHOTS, SUMMIT_SCENE_S, capPose, summitShot, type SceneBase, type SceneContext } from "./cutscene.js";
import {
  DOOR_IN_M, arrived, carDistance, carSpeed, endCar, endShot, endShotIndex, headlampAt, roadRelease, runnerPose,
  type EndShotContext, type LampAim, type RunnerPose,
} from "./endScene.js";
import { endingPose, liftShare, type EndingBase, type EndingKind } from "./ending.js";
import type { Road } from "./scene/roadPath.js";
import type { CarPose } from "./scene/timeline.js";

/**
 * The car the end scene drives, as the hike passes it from its scenery to
 * the renderer that plays the scene: `leave()`, which takes it out of the
 * rain's cover as it drives off (the cover map is drawn once for a place,
 * and a car that has gone would keep the rain off the pad it left; once is
 * enough, again is nothing), and `tailLamps(on)`, which lights and shows the
 * film's car's tail lamps at its rear, or hides them (the parked car has
 * none).
 */
export type CarHandle = { leave(): void; tailLamps(on: boolean): void };

/** What the end scene (endScene.ts) is played over: the car's site and the way it faces, the road, the door spot, and the car as it stands each frame. */
export type EndSceneSetup = {
  site: { x: number; z: number };
  direction: 1 | -1;
  road: Road;
  door: { x: number; z: number };
  car: () => CarHandle | null;
  /** The player whose run the scene shows, where it is not this screen's own (endScene.ts `endSceneRunner`): another's, who reached the car. */
  runner?: number;
};

/** The end scene this frame, for app.ts: seconds since it began, the arrival (or none yet), the shot, and the car's pose and speed. */
export type EndSceneNow = {
  t: number;
  arrival: number | null;
  shot: number;
  car: { x: number; y: number; z: number; yaw: number; speed: number };
};

/** A camera as a frame is seen through it: where it stands and how it is turned (radians; the pitch down is positive). */
export type PlayCamera = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number };

/** A place in the world. */
type Place = { x: number; y: number; z: number };

/** The local player as a frame steps the scenes on them. */
export type PlayLocal = { pos: Place; yaw: number; pitch: number };

/** What a frame's scene asks of whoever draws it. */
export type PlayNow = {
  /** The scene's lens this frame (radians, vertical), or null for the game's own. */
  fov: number | null;
  /** Whether the local player's own body is drawn: a scene's camera stands elsewhere. */
  showLocal: boolean;
  /** In the end scene, every other body within `radius` of this point (the car's door) is hidden: it is in the car. Null before one. */
  hideNear: { x: number; z: number; radius: number } | null;
  /**
   * Where the local player's one lamp is: `lens`, on the camera, as in a
   * hike (and dark there while `lensDark`, in the end scene, whose camera is
   * not the eye); `body`, worn at the eye of the local body a scene shows,
   * lit for the shot whether the player's was or not; `car`, the car's
   * headlamp at `carLamp`, from the catch.
   */
  lamp: "lens" | "body" | "car";
  lensDark: boolean;
  carLamp: LampAim;
  /** Whether the end scene has the frame: the rain's cover then follows the camera, which goes down the road from the player. */
  endRun: boolean;
};

/** What the end scene's car is moved and its leaving told by: the renderer's own. */
export type PlayDeps = {
  /** Stands `car` at `pose`: its parts where it has them, else the whole of it. */
  stage(pose: CarPose, car: CarHandle): void;
  /** The car has left the rain's cover: the map is drawn again. */
  coverLeft(): void;
};

export type ScenePlay = {
  /** A scene from `seconds` on, begun `fromS` seconds in: `at` the body, or the cap; with the Hollow's feet and the party's eye, the summit's five shots. */
  setScene(kind: "summit" | "cap", at: Place, more: { hollow: Place; party: Place } | undefined, fromS: number, seconds: number): void;
  /** The end, once; a second call of a kind changes nothing. Won needs what the scene is played over. */
  setEnding(kind: EndingKind, scene: EndSceneSetup | undefined, seconds: number): void;
  /** A death's ending undone: the camera is the player's again, and its dark and blur lift over `liftS` seconds from what they are (at once at 0). */
  clearEnding(liftS: number, seconds: number): void;
  /** The end scene as the last step left it; null when none plays. One reused object. */
  endScene(): EndSceneNow | null;
  /** How far the death's dark has closed and how soft the picture is, 0 to 1, as the last step posed them: a frame late for whoever reads them before stepping. */
  readonly close: number;
  readonly blur: number;
  /** The stare's lens as the frame shows it: the death's closing dark rides its shade, driven to full. */
  shown<T extends { level: number; phase: number }>(stare: T): T;
  /** The player whose run the end scene shows where it is not this screen's own, or undefined: the world is built round them. */
  runnerId(): number | undefined;
  /**
   * One frame. `camera` comes in as the player's own eye for the frame and
   * goes out as the frame's camera; `players` is the state's, and
   * `drawnAt` says where another player's body is drawn this frame
   * (`EntityPoses.drawnAt`). The result is one reused object.
   */
  step(seconds: number, camera: PlayCamera, local: PlayLocal, players: ReadonlyMap<number, { pos: Place; yaw: number }>, drawnAt: (id: number) => Place | null): PlayNow;
};

/**
 * A stare's lens as a frame shows it under a death's dark closed by
 * `close`, 0 to 1: the dark rides the stare's shade, driven to full, from
 * the side the death closes from; the lens itself where none has closed.
 */
export function stareWithDark<T extends { level: number; phase: number }>(stare: T, close: number): T {
  return close > 0 ? { ...stare, level: Math.max(stare.level, close), phase: 0.9 } : stare;
}

export function createScenePlay(deps: PlayDeps): ScenePlay {
  /** What the ending asks of the pass: the picture's softness and the dark's closing, 0 to 1, posed after the pass reads them, so a frame late. */
  let endBlur = 0;
  let endClose = 0;
  /** The death's ending, once begun: when it began, and the pose it began from, taken on its first frame. */
  let ending: { kind: "died"; since: number; base: EndingBase | null } = { kind: "died", since: -1, base: null };
  /** A death's dark and blur lifting after it was undone (`clearEnding`): what they were, since when, over how long; null when none is. */
  let lift: { close: number; blur: number; since: number; forS: number } | null = null;
  /**
   * The end scene, once begun: when, what it is played over, the shots'
   * context (filled in place each frame), what app.ts reads of it, where the
   * other bodies are hidden, the headlamp the lens's lamp becomes at the
   * catch, and the tail lamps, lit then.
   */
  let endRun: {
    since: number;
    setup: EndSceneSetup;
    ctx: EndShotContext;
    now: EndSceneNow;
    hide: { x: number; z: number; radius: number };
    lens: LampAim;
    /** The car whose tail lamps were last lit, at the catch. */
    tailsLit: CarHandle | null;
    /** The car standing parked, where its lamps stay when there is no model to drive. */
    parked: CarPose;
    /** The car last taken out of the rain's cover, once clear of its footprint. */
    left: CarHandle | null;
  } | null = null;
  /** The summit scene, while it plays: when it began, the eye it began from, and the body it looks at. */
  let summitScene: { kind: "summit" | "cap"; since: number; base: SceneBase | null; body: Place; more: { hollow: Place; party: Place } | null } | null = null;

  /** The runner the end scene is stepped on this frame, reused. */
  const runnerNow: RunnerPose = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, at: { x: 0, z: 0 } };
  const now: PlayNow = {
    fov: null, showLocal: false, hideNear: null, lamp: "lens", lensDark: false, carLamp: { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 }, endRun: false,
  };

  /**
   * One frame of the end scene: the arrival judged from the runner, the
   * pursuit's standpoint held from its first frame, the shot's camera and
   * lens, the local body drawn through the run and in the car from the
   * arrival, the other bodies at the door hidden, the car staged at its
   * pose, and from the catch the headlamp's place at the car's nose as posed
   * this frame and the tail lamps lit.
   */
  function stepEndScene(e: NonNullable<typeof endRun>, runner: RunnerPose, seconds: number, camera: PlayCamera): void {
    const t = seconds - e.since;
    const ctx = e.ctx;
    ctx.runner.x = runner.pos.x;
    ctx.runner.y = runner.pos.y - PLAYER_HALF.y;
    ctx.runner.z = runner.pos.z;
    ctx.runner.yaw = runner.yaw;
    ctx.eyeY = runner.pos.y + PLAYER_EYE_OFFSET;
    // By where the runner truly is: another screen's runner is hidden as they near the door, and their drawn place stops short of it.
    if (ctx.arrival === null && arrived(runner.at, ctx.door, t)) ctx.arrival = t;
    const shot = endShotIndex(t, ctx.arrival);
    if (shot === 1 && ctx.pursuitFrom === null) ctx.pursuitFrom = { x: runner.pos.x, z: runner.pos.z };
    const pose = endShot(t, ctx);
    camera.x = pose.x;
    camera.y = pose.y;
    camera.z = pose.z;
    camera.pitch = pose.pitch;
    camera.yaw = pose.yaw;
    camera.roll = 0;
    now.fov = pose.fov;
    // This screen's own body runs in the shot only where the run is its own.
    now.showLocal = ctx.arrival === null && e.setup.runner === undefined;
    now.hideNear = e.hide;
    const after = ctx.arrival === null ? 0 : t - ctx.arrival;
    const car = endCar(after, ctx.road, ctx.site, ctx.direction);
    const handle = e.setup.car();
    if (handle !== null) {
      deps.stage(car, handle);
      // Clear of its own footprint, it is no roof over the pad: out of the cover, and the map drawn again.
      if (carDistance(after) >= 2 * CAR_HALF.z && e.left !== handle) {
        handle.leave();
        deps.coverLeft();
        e.left = handle;
      }
    }
    const scene = e.now;
    scene.t = t;
    scene.arrival = ctx.arrival;
    scene.shot = shot;
    scene.car.x = car.x;
    scene.car.y = car.y;
    scene.car.z = car.z;
    scene.car.yaw = car.yaw;
    scene.car.speed = carSpeed(after);
    if (ctx.arrival === null || after < CATCH_AT_S) return;
    // With no car drawn to drive (its box alone), the lamp stays where it stands.
    headlampAt(handle === null ? e.parked : car, e.lens);
    if (handle !== null && e.tailsLit !== handle) {
      handle.tailLamps(true);
      e.tailsLit = handle;
    }
  }

  return {
    get close() {
      return endClose;
    },
    get blur() {
      return endBlur;
    },
    shown(stare) {
      return stareWithDark(stare, endClose);
    },
    runnerId() {
      return endRun === null ? undefined : endRun.setup.runner;
    },
    setScene(kind, at, more, fromS, seconds) {
      // Begun `fromS` seconds in: a return plays the summit's last shot alone (its seventeenth second on).
      summitScene = { kind, since: seconds - fromS, base: null, body: { x: at.x, y: at.y, z: at.z }, more: more ?? null };
    },
    clearEnding(liftS, seconds) {
      ending = { kind: "died", since: -1, base: null };
      // The dark and the blur go over `liftS` seconds from what they are now (the frame's step below).
      lift = liftS > 0 && (endClose > 0 || endBlur > 0) ? { close: endClose, blur: endBlur, since: seconds, forS: liftS } : null;
      if (lift === null) {
        endBlur = 0;
        endClose = 0;
      }
    },
    setEnding(kind, scene, seconds) {
      if (kind === "won") {
        if (endRun !== null || scene === undefined) return;
        const groundY = scene.road.groundY(scene.site.x, scene.site.z);
        endRun = {
          since: seconds,
          setup: scene,
          ctx: {
            runner: { x: 0, y: 0, z: 0, yaw: 0 }, eyeY: 0, site: scene.site, groundY, direction: scene.direction,
            road: scene.road, door: scene.door, arrival: null, pursuitFrom: null,
          },
          now: { t: 0, arrival: null, shot: 0, car: { x: scene.site.x, y: groundY, z: scene.site.z, yaw: scene.direction === 1 ? 0 : Math.PI, speed: 0 } },
          hide: { x: scene.door.x, z: scene.door.z, radius: DOOR_IN_M },
          lens: { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 },
          tailsLit: null,
          parked: endCar(0, scene.road, scene.site, scene.direction),
          left: null,
        };
        endRun.ctx.held = roadRelease(scene.road, scene.site, scene.direction);
        return;
      }
      if (ending.since >= 0) return;
      ending = { kind, since: seconds, base: null };
    },
    endScene() {
      return endRun === null ? null : endRun.now;
    },
    step(seconds, camera, local, players, drawnAt) {
      // The summit scene: from the flip's frame the camera is the scene's,
      // from the eye the player had then, for the reveal's seconds.
      now.fov = null;
      let sceneShot = -1;
      if (summitScene !== null && ending.since < 0 && endRun === null) {
        const t = seconds - summitScene.since;
        if (t >= (summitScene.kind === "summit" ? SUMMIT_SCENE_S : CAP_SCENE_S)) summitScene = null;
        else {
          summitScene.base ??= { x: camera.x, y: camera.y, z: camera.z, yaw: local.yaw, pitch: local.pitch };
          if (summitScene.kind === "summit" && summitScene.more !== null) {
            const ctx: SceneContext = { base: summitScene.base, body: summitScene.body, hollow: summitScene.more.hollow, party: summitScene.more.party };
            const shot = summitShot(t, ctx);
            // A live shot (the threshold) is the player's own camera: the look app.ts drives, the lens the game's.
            if (!shot.live) {
              camera.x = shot.x;
              camera.y = shot.y;
              camera.z = shot.z;
              camera.pitch = shot.pitch;
              camera.yaw = shot.yaw;
              camera.roll = 0;
            }
            now.fov = shot.fov;
            sceneShot = shot.shot;
          } else {
            const pose = capPose(t, summitScene.base, summitScene.body);
            camera.x = pose.x;
            camera.y = pose.y;
            camera.z = pose.z;
            camera.pitch = pose.pitch;
            camera.yaw = pose.yaw;
            camera.roll = 0;
          }
        }
      }
      // The local body stands in the summit's shots, until the last returns to its eye.
      now.showLocal = sceneShot >= 0 && sceneShot < SHOTS.length - 1;
      // The end scene: its camera and lens, the body through the run, the car.
      if (endRun !== null) {
        // Whose run it is stepped on: this screen's own player, or the one the setup names (who reached the car),
        // where their body is drawn this frame (endScene.ts `runnerPose`).
        const id = endRun.setup.runner;
        const other = id === undefined ? undefined : players.get(id);
        stepEndScene(endRun, runnerPose(runnerNow, local, other, other === undefined || id === undefined ? null : drawnAt(id), PLAYER_HALF.y), seconds, camera);
      }
      // The end: from its first frame the camera is the ending's, from the
      // pose the player had then, and the pass takes its blur and its dark.
      if (ending.since >= 0) {
        ending.base ??= { x: camera.x, y: camera.y, z: camera.z, yaw: local.yaw, pitch: local.pitch, feetY: local.pos.y - PLAYER_HALF.y };
        const pose = endingPose(ending.kind, seconds - ending.since, ending.base);
        camera.x = pose.x;
        camera.y = pose.y;
        camera.z = pose.z;
        camera.pitch = pose.pitch;
        camera.yaw = pose.yaw;
        camera.roll = pose.roll;
        endBlur = pose.blur;
        endClose = pose.close;
      } else if (lift !== null) {
        // A death undone (a return): its dark and blur lifting, evenly, to nothing.
        const share = liftShare(seconds - lift.since, lift.forS);
        endClose = lift.close * share;
        endBlur = lift.blur * share;
        if (share <= 0) lift = null;
      }
      // The lamp: the car's headlamp from the catch; worn at the body's eye wherever a scene shows the body; else on
      // the lens, and dark there in the end scene, whose camera is not the eye.
      const e = endRun;
      now.endRun = e !== null;
      now.lensDark = e !== null;
      if (e !== null && e.ctx.arrival !== null && e.now.t - e.ctx.arrival >= CATCH_AT_S) {
        now.lamp = "car";
        now.carLamp = e.lens;
      } else now.lamp = now.showLocal ? "body" : "lens";
      return now;
    },
  };
}
