import { describe, expect, it } from "vitest";
import { INTRO_CAPTIONS, INTRO_DURATION, INTRO_SHOTS, introScene } from "../../../src/game/scene/intro.js";
import { evaluate } from "../../../src/game/scene/timeline.js";
import { FOV_MAX, FOV_MIN } from "../../../src/game/scene/shots.js";

const road = { centerX: (z: number) => -250 + 0.02 * z, groundY: () => 10 };
const places = { car: { x: -246, z: 0 }, start: { x: -240, z: 4, yaw: 1.1 }, board: { x: -236, z: 9 }, direction: 1 as const };

describe("the intro's data", () => {
  it("has eight shots that sum to seventy-two seconds", () => {
    expect(INTRO_SHOTS.map((s) => [s.from, s.to])).toEqual([[0, 9], [9, 15], [15, 30.6], [30.6, 38.4], [38.4, 48], [48, 55], [55, 62], [62, 72]]);
    expect(INTRO_DURATION).toBe(72);
  });

  it("drives the car along the road to its site by the end of shot 6, and holds it there", () => {
    const scene = introScene(road, places);
    const at = (t: number) => evaluate(scene, t).car;
    expect(at(0)?.z).toBe(-618);
    expect(at(55)?.z).toBeCloseTo(0, 6);
    expect(at(55)?.x).toBeCloseTo(-246, 6);
    expect(at(40)?.x).toBeCloseTo(road.centerX(at(40)?.z ?? 0) + 1.8, 6);
    expect(at(66)?.z).toBeCloseTo(0, 6);
    expect(at(20)?.wheelSpin).toBeGreaterThan(at(19)?.wheelSpin ?? 0);
    expect(at(57)?.doorOpen).toBeGreaterThan(0);
    expect(at(52)?.doorOpen).toBe(0);
  });

  it("has the car pass the low camera on the shoulder at 41.6 s", () => {
    const scene = introScene(road, places);
    const frame = evaluate(scene, 41.6);
    expect(Math.abs((frame.car?.z ?? 0) - frame.camera.z)).toBeLessThan(0.5);
    expect(evaluate(scene, 39).car?.z ?? 0).toBeLessThan(frame.camera.z);
  });

  it("captions every line of the call on its recorded times", () => {
    expect(INTRO_CAPTIONS.map((c) => [c.from, c.to])).toEqual([
      [15, 17.14], [17.14, 19.04], [19.04, 23.82], [23.82, 26.28], [26.28, 30.58], [30.58, 33.52],
      [33.52, 35.98], [35.98, 41.24], [41.24, 45.46], [45.46, 48.42], [48.42, 51.86],
    ]);
    for (const c of INTRO_CAPTIONS) {
      const lines = c.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(42);
      expect(c.text.replace("\n", " ").length / (c.to - c.from)).toBeLessThanOrEqual(20);
    }
    const scene = introScene(road, places);
    expect(evaluate(scene, 16).caption?.text).toBe("Four-one, dispatch.");
    expect(evaluate(scene, 46).caption?.text).toBe("If anything... ...get back to the road.");
    expect(evaluate(scene, 53).caption).toBeNull();
  });

  it("fades in over two seconds and ends on the held picture: the black after it is the playback's", () => {
    const scene = introScene(road, places);
    expect(evaluate(scene, 0).black).toBe(1);
    expect(evaluate(scene, 1).black).toBe(0.5);
    expect(evaluate(scene, 30).black).toBe(0);
    expect(evaluate(scene, 69).black).toBe(0);
    expect(evaluate(scene, 72).black).toBe(0);
  });

  it("seats the ranger at the wheel from the start, his chest on the seat's mark in the moving car", () => {
    const scene = introScene(road, places);
    const r = evaluate(scene, 5).actors[0]!;
    expect([r.id, r.clip, r.visible]).toEqual(["intro.ranger", "drive", true]);
    expect(r.anchor?.joint).toBe("chest");
    expect(r.anchor?.x).toBeCloseTo(-259.768179, 5);
    expect(r.anchor?.y).toBeCloseTo(10.925, 6);
    expect(r.anchor?.z).toBeCloseTo(-557.854809, 5);
  });

  it("eases the handset from its cradle into the fist over 0.3 s, and back", () => {
    const scene = introScene(road, places);
    const grip = (t: number) => evaluate(scene, t).car?.grip;
    expect([grip(15.5), grip(15.6), grip(16), grip(40), grip(52.8)]).toEqual([0, 0, 1, 1, 0]);
    expect(grip(15.75)).toBeCloseTo(0.5, 6);
    expect(grip(52.55)).toBeCloseTo(0.5, 6);
    expect(grip(52.69)).toBeCloseTo(0.003259, 6);
  });

  it("plays the call: the reach, the handset taken and put back, the talk, the lower", () => {
    const scene = introScene(road, places);
    const clip = (t: number) => evaluate(scene, t).actors[0]?.clip;
    const handset = (t: number) => evaluate(scene, t).car?.handset;
    expect([clip(14), clip(15.2), clip(20), clip(52), clip(54.5)]).toEqual(["drive", "reach", "talk", "lower", "drive"]);
    expect([handset(15.5), handset(15.7), handset(52.6), handset(52.8)]).toEqual(["cradle", "hand", "hand", "cradle"]);
    // A function of t: a seek back from the call finds the handset in its cradle.
    expect(handset(10)).toBe("cradle");
  });

  it("mixes each clip in over 0.3 s from the one before", () => {
    const scene = introScene(road, places);
    const into = evaluate(scene, 16.6).actors[0]!;
    expect(into.clip).toBe("talk");
    expect(into.blend?.clip).toBe("reach");
    expect(into.blend?.weight).toBeCloseTo(0.740741, 6);
    expect(evaluate(scene, 17).actors[0]?.blend).toBeUndefined();
  });

  it("holds a clip that does not loop at its last frame", () => {
    const scene = introScene(road, places);
    const face = evaluate(scene, 70).actors[0]!;
    expect(face.clip).toBe("face_trail");
    expect(face.clipTime).toBeCloseTo(3.983333, 6);
  });

  it("turns him out of the seat at the stop, his hips carried from the seat to outside the door", () => {
    const scene = introScene(road, places);
    const start = evaluate(scene, 55).actors[0]!;
    expect(start.clip).toBe("door");
    expect(start.anchor?.joint).toBe("hips");
    expect(start.anchor?.x).toBeCloseTo(-246.389282, 5);
    expect(start.anchor?.y).toBeCloseTo(10.515, 6);
    expect(start.anchor?.z).toBeCloseTo(0.239832, 5);
    const mid = evaluate(scene, 56.5).actors[0]!;
    expect(mid.anchor?.x).toBeCloseTo(-246.817017, 5);
    expect(mid.anchor?.y).toBeCloseTo(10.7325, 6);
    expect(mid.anchor?.z).toBeCloseTo(0.257389, 5);
  });

  it("walks him from the door to the spawn, and stands him there facing the trail", () => {
    const scene = introScene(road, places);
    const walking = evaluate(scene, 60.5).actors[0]!;
    expect(walking.clip).toBe("walk");
    expect(walking.anchor).toBeUndefined();
    const standing = evaluate(scene, 67).actors[0]!;
    expect([standing.clip, standing.x, standing.z, standing.yaw]).toEqual(["face_trail", -240, 4, 1.1]);
  });
  it("walks him around the parked car, never through it, at a walking pace", () => {
    const scene = introScene(road, places);
    const c = evaluate(scene, 58).car!;
    const sin = Math.sin(c.yaw), cos = Math.cos(c.yaw);
    let last: { x: number; z: number } | null = null;
    for (let t = 58.05; t < 64; t += 0.05) {
      const r = evaluate(scene, t).actors[0]!;
      const dx = r.x - c.x, dz = r.z - c.z;
      const x = dx * cos - dz * sin, z = dx * sin + dz * cos;
      // The car's footprint, 0.9 m and 2.3 m to a side, and 0.3 m more for his body.
      expect(Math.abs(x) > 1.2 || Math.abs(z) > 2.6, `inside the car at ${t.toFixed(2)} s: ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(true);
      if (last !== null) expect(Math.hypot(r.x - last.x, r.z - last.z) / 0.05).toBeLessThan(2);
      last = r;
    }
  });

  it("keeps every shot's field of view within the film's range but the cab shot", () => {
    const scene = introScene(road, places);
    for (const [i, s] of INTRO_SHOTS.entries()) {
      const fov = evaluate(scene, (s.from + s.to) / 2).camera.fov;
      if (i === 2) expect(fov).toBe(0.9);
      else {
        expect(fov).toBeGreaterThanOrEqual(FOV_MIN);
        expect(fov).toBeLessThanOrEqual(FOV_MAX);
      }
    }
    // The coastal wide within the mist's reach: 0.25 rad from 70 m out.
    expect(evaluate(scene, 4).camera.fov).toBe(0.25);
    expect(evaluate(scene, 34).camera.dof).toBe(true);
    expect(evaluate(scene, 12).camera.dof).toBe(false);
  });

});
