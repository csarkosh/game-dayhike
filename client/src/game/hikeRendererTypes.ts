/**
 * A hike's renderer, as the hike holds it: the engine's renderer of the world
 * (`rendererTypes.ts`, `WorldRenderer`) over Day Hike's state, and beside it what is Day Hike's
 * own to ask of a frame: the stare and the chase's look, the way down, the crowd, and the scenes
 * and endings. Types alone, which load nothing.
 */
import type { StareLens } from "@csarkosh/engine/game/stareLens";
import type { WorldState } from "../sim/types.js";
import type { WayDown } from "../sim/wayDown.js";
import type { CrowdFigure } from "./crowdField.js";
import type { WorldRenderer } from "@csarkosh/engine/game/rendererTypes";
import type { EndSceneNow, EndSceneSetup } from "./scenePlay.js";

/** What is Day Hike's own on its renderer. */
export type HikeApi = {
  /** The local player's stare as `sync` last stepped it, for the audio (stareAudio.ts). */
  stare(): StareLens;
  /** The chase's cast, 0 to 1 (escalation.ts): the grade pulls the frame toward burgundy by it. */
  setChase(cast: number): void;
  /** The haunt, 0 to 1 (escalation.ts): the pale mist at the player's sides comes in by it. */
  setHaunt(level: number): void;
  /** How far the mist has come in, 0 to 1 (acts.ts): the ground cloud rises by it, after the night. */
  setMistIn(level: number): void;
  /** The way down to draw in mist in the chase (wayLight.ts), or none, and the ground its mist stands on (the sim's field, as the players stand on it): the app gives every renderer the world's, when it has it. */
  setWay(way: WayDown | null, heightAt: (x: number, z: number) => number): void;
  /**
   * The way's mist, 0 to 1 (wayLevel.ts): the way's mist is drawn at it, the
   * rest of the frame is dimmed by it (`wayDimAt`), and where the ground
   * mist has a ground map it thins over the way in place of the trail.
   */
  setWayLevel(level: number): void;
  /**
   * This screen's crowd for the frame (crowdField.ts), told before `sync`: its figures are drawn as cards, in the
   * frame and in the shade mask, and as eyes. While `shadows`, the chase's killers are drawn among them, as
   * shadows with the Hollow's red eyes, and not as the model (crowdKillers.ts).
   */
  setCrowd(figures: readonly CrowdFigure[], seconds: number, shadows: boolean): void;
  /**
   * What stands at the centre of the local player's view in the chase (chaseThreat.ts, 0 to 1), told before
   * `sync`; null where the chase does not have them. While it is given the frame's dark is the chase's own
   * (stareLens.ts): there the whole way down, never closed far, beating faster by this.
   */
  setChaseThreat(threat: number | null): void;
  /**
   * The end for this player, once; a second call changes nothing. Died: the
   * camera is the death's from now (ending.ts). Won: the end scene plays
   * over the player's camera from now (endScene.ts): the run, the car, the
   * road, the arrival judged each frame from the local body.
   */
  setEnding(kind: "died"): void;
  setEnding(kind: "won", scene: EndSceneSetup): void;
  /** The end scene as the last `sync` stepped it; null when none plays. One reused object. */
  endScene(): EndSceneNow | null;
  /** A scene (cutscene.ts): the camera is the scene's from now; the summit's five shots for SUMMIT_SCENE_S (`at` the body, with the Hollow's feet and the party's eye); the cap's for CAP_SCENE_S, turned to it. */
  setScene(kind: "summit" | "cap", at: { x: number; y: number; z: number }, more?: { hollow: { x: number; y: number; z: number }; party: { x: number; y: number; z: number } }, fromS?: number): void;
  /** A death's ending undone (a return in the chase, deathReturn.ts): the camera is the player's again and a scene's may run; its dark and blur lift over `liftS` seconds (at once by default). The won scene is left as it is. */
  clearEnding(liftS?: number): void;
  /** 0 silences the lens-side dread effects; 1 is full. */
  setUnsettle(level: number): void;
};

export type Renderer = WorldRenderer<WorldState> & HikeApi;
