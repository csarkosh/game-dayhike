import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { SHOTS } from "../../src/game/cutscene.js";
import { createEntityPoses, type EntityFrame, type EntityModels } from "../../src/game/entityPoses.js";
import { createScenePlay, type PlayCamera } from "../../src/game/scenePlay.js";
import { bodiesInShot } from "../../src/game/shotBodies.js";
import { windTestPlayer, windTestState } from "./helpers/rendererWorld.js";

const models: EntityModels = { player: () => true, hollow: () => true };
const LOCAL = 3;

/** A hike's frames as its renderer steps them: the bodies posed, the scene stepped on the eye, and the bodies under what the scene shows. */
function hike() {
  const poses = createEntityPoses();
  const play = createScenePlay({ stage: () => undefined, coverLeft: () => undefined });
  const state = windTestState(windTestPlayer(LOCAL), windTestPlayer(4));
  const local = state.players.get(LOCAL)!;
  const camera: PlayCamera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  const frame = (seconds: number): { before: string | null; drawn: EntityFrame; lamp: string } => {
    const posed = poses.step(state, LOCAL, 1, 1 / 60, models);
    const before = posed.players.find((body) => body.local)?.hidden ?? null;
    const now = play.step(seconds, camera, local, state.players, (id) => poses.drawnAt(id));
    const drawn = bodiesInShot(poses, posed, now, state, LOCAL, 1, models) as EntityFrame;
    return { before, drawn, lamp: now.lamp };
  };
  return { poses, play, state, frame };
}
const own = (drawn: EntityFrame) => drawn.players.find((body) => body.local)!;
const body = { x: 30, y: 41, z: 20 };
const more = { hollow: { x: 33, y: 41, z: 24 }, party: { x: 20, y: 42, z: 20 } };

describe("the local hiker's own body in a scene's shot", () => {
  it("is hidden through a hike: the camera is its eyes", () => {
    const { frame } = hike();
    expect(own(frame(1).drawn).hidden).toBe("lens");
    expect(own(frame(2).drawn).hidden).toBe("lens");
  });

  it("stands in a shot from the shot's first frame, with the lamp it wears there", () => {
    const { play, frame } = hike();
    frame(7.9);
    play.setScene("summit", body, more, 0, 8);
    const first = frame(8);
    // Posed before the scene was stepped, the body was still the lens's: it is posed again for this frame.
    expect(first.before).toBe("lens");
    expect(own(first.drawn).hidden).toBeNull();
    expect(own(first.drawn).modelled).toBe(true);
    expect(first.lamp).toBe("body");
    // And stands on through the shots that show it, posed once a frame.
    const second = frame(8 + 1 / 60);
    expect(second.before).toBeNull();
    expect(own(second.drawn).hidden).toBeNull();
  });

  it("is gone from the first frame of the shot that hands the camera back to its eyes", () => {
    const { play, frame } = hike();
    play.setScene("summit", body, more, 0, 8);
    const last = SHOTS.slice(0, -1).reduce((a, b) => a + b, 0);
    expect(own(frame(8 + last - 0.01).drawn).hidden).toBeNull();
    const back = frame(8 + last);
    // The frame's first pose still drew the body, round the eye the camera has just been handed.
    expect(back.before).toBeNull();
    expect(own(back.drawn).hidden).toBe("lens");
    expect(back.lamp).toBe("lens");
  });

  it("leaves every other body, and the frame's record, as they were posed where the scene changes nothing", () => {
    const { poses, state, frame } = hike();
    const posed = poses.step(state, LOCAL, 1, 1 / 60, models);
    expect(bodiesInShot(poses, posed, { showLocal: false, hideNear: null }, state, LOCAL, 1, models)).toBe(posed);
    const other = frame(3).drawn.players.find((b) => !b.local)!;
    expect(other.hidden).toBeNull();
    // A door named again by the same numbers is the same door: nothing is posed twice.
    const door = { x: 100, z: 100, radius: 2 };
    bodiesInShot(poses, posed, { showLocal: false, hideNear: door }, state, LOCAL, 1, models);
    const again = poses.step(state, LOCAL, 1, 1 / 60, models);
    expect(bodiesInShot(poses, again, { showLocal: false, hideNear: { ...door } }, state, LOCAL, 1, models)).toBe(again);
  });

  it("hides the bodies at the car's door from the frame the scene names it", () => {
    const { poses, state } = hike();
    const other = state.players.get(4)!;
    const posed = poses.step(state, LOCAL, 1, 1 / 60, models);
    expect(posed.players.find((b) => b.id === 4)?.hidden).toBeNull();
    const drawn = bodiesInShot(poses, posed, { showLocal: false, hideNear: { x: other.pos.x, z: other.pos.z, radius: 1 } }, state, LOCAL, 1, models) as EntityFrame;
    expect(drawn.players.find((b) => b.id === 4)?.hidden).toBe("car");
  });

  it("keeps what the scene says while no body can be drawn yet", () => {
    const { poses, state } = hike();
    expect(bodiesInShot(poses, null, { showLocal: true, hideNear: null }, state, LOCAL, 1, null)).toBeNull();
    expect(poses.showLocal).toBe(true);
  });
});
