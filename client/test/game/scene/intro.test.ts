import { describe, expect, it } from "vitest";
import { INTRO_CAPTIONS, INTRO_DURATION, INTRO_SHOTS, introScene } from "../../../src/game/scene/intro.js";
import { evaluate } from "../../../src/game/scene/timeline.js";
import { FOV_MAX, FOV_MIN } from "../../../src/game/scene/shots.js";

const road = { centerX: (z: number) => -250 + 0.02 * z, groundY: () => 10 };
const places = { car: { x: -246, z: 0 }, start: { x: -240, z: 4, yaw: 1.1 }, board: { x: -236, z: 9 }, direction: 1 as const };

describe("the intro's data", () => {
  it("has eight shots that sum to sixty seconds at the script's times", () => {
    expect(INTRO_SHOTS.map((s) => [s.from, s.to])).toEqual([[0, 9], [9, 15], [15, 25], [25, 30], [30, 36], [36, 43], [43, 50], [50, 60]]);
    expect(INTRO_DURATION).toBe(60);
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
    expect(evaluate(scene, 27).camera.dof).toBe(true);
    expect(evaluate(scene, 12).camera.dof).toBe(false);
  });

  it("drives the car along the road to its site by the end of shot 6, and holds it there", () => {
    const scene = introScene(road, places);
    const at = (t: number) => evaluate(scene, t).car;
    expect(at(0)?.z).toBe(-470);
    expect(at(43)?.z).toBeCloseTo(0, 6);
    // Stopped on the shoulder where the hike's car stands, not in its lane.
    expect(at(43)?.x).toBeCloseTo(-246, 6);
    expect(at(30)?.x).toBeCloseTo(road.centerX(at(30)?.z ?? 0) + 1.8, 6);
    expect(at(55)?.z).toBeCloseTo(0, 6);
    expect(at(20)?.wheelSpin).toBeGreaterThan(at(19)?.wheelSpin ?? 0);
    expect(at(45)?.doorOpen).toBeGreaterThan(0);
    expect(at(40)?.doorOpen).toBe(0);
  });

  it("keeps the ranger out of sight until the step out, then standing at the spawn facing the trail", () => {
    const scene = introScene(road, places);
    expect(evaluate(scene, 20).actors[0]?.visible).toBe(false);
    const stepping = evaluate(scene, 45).actors[0];
    expect(stepping?.visible).toBe(true);
    expect(stepping?.clip).toBe("walk");
    const standing = evaluate(scene, 55).actors[0];
    expect(standing?.clip).toBe("idle");
    expect(standing?.x).toBeCloseTo(-240, 6);
    expect(standing?.z).toBeCloseTo(4, 6);
    expect(standing?.yaw).toBe(1.1);
  });

  it("captions every line of the call at most two lines of 42 characters, no faster than 20 a second, none before shot 3", () => {
    expect(INTRO_CAPTIONS.length).toBe(11);
    for (const c of INTRO_CAPTIONS) {
      const lines = c.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(42);
      expect(c.text.replace("\n", " ").length / (c.to - c.from)).toBeLessThanOrEqual(20);
      expect(c.from).toBeGreaterThanOrEqual(15);
    }
    const scene = introScene(road, places);
    expect(evaluate(scene, 16).caption?.text).toBe("Four-one, dispatch.");
    expect(evaluate(scene, 50).caption).toBeNull();
  });

  it("fades in over two seconds and ends on the held picture: the black after it is the playback's", () => {
    const scene = introScene(road, places);
    expect(evaluate(scene, 0).black).toBe(1);
    expect(evaluate(scene, 1).black).toBe(0.5);
    expect(evaluate(scene, 30).black).toBe(0);
    expect(evaluate(scene, 57).black).toBe(0);
    expect(evaluate(scene, 60).black).toBe(0);
  });
});
