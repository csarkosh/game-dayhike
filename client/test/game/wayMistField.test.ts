import { describe, expect, it } from "vitest";
import { createWayFieldFollow, emptyWayFieldUniforms } from "../../src/game/wayMistField.js";
import { FIELD_FILL_A_FRAME, FIELD_FIN_STRENGTH, FIELD_FLOATS, FIELD_FROM_M, FIELD_RIM_M, FIELD_SHEET_STRENGTH, FIELD_TOP_M, FIELD_VERTICES, FIELD_WHOLE_M } from "../../src/game/wayMistFieldGeometry.js";
import { WAY_CURL, WAY_HEAD, WAY_HEAVE, WAY_HIDE_SHARE, wayTint } from "../../src/game/wayLightGeometry.js";
import { wayMistFrame } from "../../src/game/wayLight.js";
import { CHASE_TINT } from "../../src/game/gradeParams.js";
import { makeWay } from "../../src/sim/wayDown.js";

const EYE = { x: 30, y: 12, z: 0 };
const MIST = { r: 0.032, g: 0.035, b: 0.033 };
const way = makeWay(Array.from({ length: 60 }, (_, i) => ({ x: i * 2, z: 0 })), 118, false);

describe("the mist beyond the way: what its material is drawn with", () => {
  it("is given the field's numbers, and no mist until a frame has some", () => {
    const u = emptyWayFieldUniforms();
    expect(u.wayFieldMist).toEqual([FIELD_SHEET_STRENGTH, FIELD_FIN_STRENGTH, FIELD_TOP_M, WAY_HIDE_SHARE]);
    expect(u.wayFieldReach).toEqual([FIELD_FROM_M, FIELD_WHOLE_M, FIELD_RIM_M[0], FIELD_RIM_M[1]]);
    expect(u.wayHead).toEqual([WAY_HEAD]);
    expect(u.wayGain).toEqual([0]);
    expect(u.wayMove).toEqual([WAY_HEAVE, WAY_CURL, 0, 0]);
    expect(Object.keys(u).sort()).toEqual(["wayDrift", "wayFieldMist", "wayFieldReach", "wayGain", "wayHead", "wayMove", "wayTint"]);
  });

  it("takes the way's mist's level, drift and colour, with the chase's cast, as the way's own mist does on the material path", () => {
    const u = emptyWayFieldUniforms();
    wayMistFrame("material", 0.5, 1, MIST, 3, 1, u);
    expect(u.wayGain).toEqual([0.5]);
    const want = wayTint("material", MIST, 1, 1, CHASE_TINT);
    for (let i = 0; i < 3; i++) expect(u.wayTint[i]).toBeCloseTo(want[i]!, 6);
    expect(u.wayDrift.some((v) => v !== 0)).toBe(true);
  });
});

describe("the mist beyond the way: its vertices round the eye", () => {
  it("has room for every vertex, each saying it is under nothing from the way until its ground is known", () => {
    const follow = createWayFieldFollow();
    expect(follow.positions.length).toBe(FIELD_VERTICES * 3);
    expect(follow.field.length).toBe(FIELD_VERTICES * FIELD_FLOATS);
    expect(follow.field.every((v) => v === -1)).toBe(true);
  });

  it("stands on the ground a few cells a frame, the eye's own first, and says when its vertices have changed", () => {
    const follow = createWayFieldFollow();
    let asked = 0;
    const ground = (): number => { asked++; return 10; };
    expect(follow.step(EYE, way, ground)).toBe(true);
    expect(asked).toBe(FIELD_FILL_A_FRAME);
    expect(FIELD_FILL_A_FRAME).toBe(40);
    // The eye's own cell is on the ground at once: the lowest sheet's middle vertex.
    const centre = 12 * 25 + 12;
    expect(follow.positions[centre * 3 + 1]).toBeCloseTo(10 + 0.08 + 0.25, 4);
    expect(follow.field[centre * FIELD_FLOATS]).toBeGreaterThanOrEqual(0);
    // Until the square is whole every frame learns more; then a frame in the same cell changes nothing.
    let frames = 1;
    while (follow.step(EYE, way, ground)) frames++;
    expect(frames).toBe(Math.ceil((25 * 25) / FIELD_FILL_A_FRAME));
    expect(asked).toBe(25 * 25);
    expect(follow.step({ x: 30.4, y: 12, z: 0.3 }, way, ground)).toBe(false);
    expect(asked).toBe(25 * 25);
  });

  it("asks for one new row when the eye crosses into another cell, and for the whole square again over another way", () => {
    const follow = createWayFieldFollow();
    let asked = 0;
    const ground = (): number => { asked++; return 10; };
    while (follow.step(EYE, way, ground)) { /* fill */ }
    asked = 0;
    expect(follow.step({ x: 33, y: 12, z: 0 }, way, ground)).toBe(true);
    expect(asked).toBe(25);
    const other = makeWay(Array.from({ length: 60 }, (_, i) => ({ x: i * 2, z: 9 })), 118, false);
    asked = 0;
    expect(follow.step({ x: 33, y: 12, z: 0 }, other, ground)).toBe(true);
    expect(asked).toBe(FIELD_FILL_A_FRAME);
  });
});
