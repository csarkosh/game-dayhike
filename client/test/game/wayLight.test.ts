import { describe, expect, it } from "vitest";
import { WAY_DEPTH_SLOPE, WAY_HEIGHTS_A_SLICE, emptyWayLightUniforms, standWayChunk, wayMistFrame, type WayChunkData } from "../../src/game/wayLight.js";
import {
  WAY_CURL, WAY_DENSITY_FLOOR, WAY_EDGE_M, WAY_FIN_SHARE, WAY_GROUND_BAND, WAY_GROUND_CORE, WAY_GROUND_REACH, WAY_HEAD, WAY_HEAVE, WAY_HIDE_SHARE, WAY_LIFT_M, WAY_LIGHT_FLOATS, WAY_MATERIAL_LIFT,
  WAY_MIST_REACH, WAY_NEAR_DAMP, WAY_PATH_SHARE, WAY_PATH_TOP_M, WAY_POINT_GROUNDS, WAY_POINT_VERTICES, WAY_POST_LIFT, WAY_SHEET_STRENGTH, WAY_STRATA_M, WAY_VEIL_STRENGTH,
  wayCastOnMaterial, wayChunk, wayChunks, wayDrift, wayHeavePhases, wayMistColour, type WayShape,
} from "../../src/game/wayLightGeometry.js";
import { CHASE_TINT } from "../../src/game/gradeParams.js";

/** A straight way along +x, a point every 2 m, `n` points. */
function straight(n: number): WayShape {
  const xs = new Float32Array(n), zs = new Float32Array(n), cum = new Float32Array(n);
  for (let i = 0; i < n; i++) { xs[i] = i * 2; cum[i] = i * 2; }
  return { xs, zs, cum, length: (n - 1) * 2 };
}
/** A stretch stood to its end, with the most heights any slice asked for. */
function stood(way: WayShape, ground: (x: number, z: number) => number, from: number, to: number): { data: WayChunkData; slices: number } {
  const slices = standWayChunk(way, ground, from, to);
  let n = 1;
  for (;;) {
    const step = slices.next();
    if (step.done === true) return { data: step.value, slices: n };
    n++;
  }
}
/** The ground mist's colour in the chase at night, about. */
const MIST = { r: 0.032, g: 0.035, b: 0.033 };

describe("the way's mist: what its material is drawn with", () => {
  it("is given the geometry's numbers, and no mist until a frame has some", () => {
    const u = emptyWayLightUniforms();
    expect(u.wayMist).toEqual([WAY_VEIL_STRENGTH, WAY_FIN_SHARE, WAY_SHEET_STRENGTH, WAY_HIDE_SHARE]);
    expect(u.wayGround).toEqual([WAY_GROUND_BAND, WAY_GROUND_CORE, WAY_GROUND_REACH, WAY_MIST_REACH]);
    expect(u.wayPath).toEqual([WAY_PATH_SHARE, WAY_PATH_TOP_M, WAY_NEAR_DAMP, WAY_DENSITY_FLOOR]);
    expect(u.wayStrata).toEqual([WAY_STRATA_M]);
    expect(u.wayHead).toEqual([WAY_HEAD]);
    expect(u.wayGain).toEqual([0]);
    expect(u.wayMove).toEqual([WAY_HEAVE, WAY_CURL, 0, 0]);
    expect(u.wayEdge).toEqual([...WAY_EDGE_M]);
    expect(Object.keys(u).sort()).toEqual(["wayDrift", "wayEdge", "wayGain", "wayGround", "wayHead", "wayMist", "wayMove", "wayPath", "wayStrata", "wayTint"]);
    // Toward the eye is up on a depth that runs from 1 at the near plane: the lowest sheet is pulled ahead of the ground.
    expect(WAY_DEPTH_SLOPE).toBeGreaterThan(0);
  });

  it("takes its level and, on the post path, its colour from the ground mist with the frame's dim taken back out of it", () => {
    const u = emptyWayLightUniforms();
    wayMistFrame("post", 0.5, 2, MIST, 0, 0, u);
    expect(u.wayGain).toEqual([0.5]);
    const want = wayMistColour(MIST, WAY_POST_LIFT * 2);
    for (let i = 0; i < 3; i++) expect(u.wayTint[i]).toBeCloseTo(want[i]!, 6);
    // Another night's mist, another colour: nothing of it is fixed.
    wayMistFrame("post", 1, 2, { r: 0.1, g: 0.02, b: 0.02 }, 0, 0, u);
    expect(u.wayTint[0]).toBeGreaterThan(u.wayTint[2]);
  });

  it("on the material path its colour is in the frame's own terms, whatever the dim", () => {
    const u = emptyWayLightUniforms();
    wayMistFrame("material", 1, 2, MIST, 0, 0, u);
    const want = wayMistColour(MIST, WAY_MATERIAL_LIFT);
    for (let i = 0; i < 3; i++) expect(u.wayTint[i]).toBeCloseTo(want[i]!, 6);
  });

  it("on the material path nothing grades the mist, so it takes the chase's cast itself, as the cast comes in", () => {
    const u = emptyWayLightUniforms();
    wayMistFrame("material", 1, 2, MIST, 0, 1, u);
    const plain = wayMistColour(MIST, WAY_MATERIAL_LIFT), cast = wayCastOnMaterial(CHASE_TINT);
    for (let i = 0; i < 3; i++) expect(u.wayTint[i]).toBeCloseTo(plain[i]! * cast[i]!, 6);
    // Redder than it was, and as bright.
    expect(u.wayTint[0] / u.wayTint[2]).toBeGreaterThan(plain[0]! / plain[2]!);
    wayMistFrame("material", 1, 2, MIST, 0, 0.5, u);
    for (let i = 0; i < 3; i++) expect(u.wayTint[i]).toBeCloseTo(plain[i]! * (1 + (cast[i]! - 1) * 0.5), 6);
  });

  it("on the post path the mist is graded with the frame: the cast is not put on it twice", () => {
    const u = emptyWayLightUniforms();
    wayMistFrame("post", 1, 2, MIST, 0, 1, u);
    const want = wayMistColour(MIST, WAY_POST_LIFT * 2);
    for (let i = 0; i < 3; i++) expect(u.wayTint[i]).toBeCloseTo(want[i]!, 6);
  });

  it("is never still: its shapes drift and its banks heave with the frame's seconds", () => {
    const u = emptyWayLightUniforms();
    wayMistFrame("post", 1, 1, MIST, 10, 0, u);
    const drift10 = [...u.wayDrift], move10 = [...u.wayMove];
    const d = wayDrift(10), p = wayHeavePhases(10);
    for (let i = 0; i < 4; i++) expect(drift10[i]).toBeCloseTo(d[i]!, 6);
    expect(move10[0]).toBe(WAY_HEAVE);
    expect(move10[1]).toBe(WAY_CURL);
    expect(move10[2]).toBeCloseTo(p[0], 6);
    expect(move10[3]).toBeCloseTo(p[1], 6);
    wayMistFrame("post", 1, 1, MIST, 10.5, 0, u);
    expect([...u.wayDrift]).not.toEqual(drift10);
    expect(u.wayMove.slice(2)).not.toEqual(move10.slice(2));
  });
});

describe("the way's mist: a stretch stood on the ground", () => {
  it("asks for a few of the ground's heights a slice, each place once, never once a vertex", () => {
    // The ground's height is the dear part (the walkable rock's layer is several reads a place): no slice asks for many.
    const way = straight(40);
    let asked = 0, most = 0, slices = 0;
    const ground = (): number => { asked++; return 10; };
    for (const [from, to] of wayChunks(way)) {
      const job = standWayChunk(way, ground, from, to);
      for (;;) {
        const before = asked;
        const step = job.next();
        slices++;
        most = Math.max(most, asked - before);
        if (step.done === true) break;
      }
    }
    expect(most).toBeLessThanOrEqual(WAY_HEIGHTS_A_SLICE);
    expect(WAY_HEIGHTS_A_SLICE).toBe(24);
    // 40 points, the chunks' shared one twice.
    expect(asked).toBe(41 * WAY_POINT_GROUNDS);
    expect(slices).toBeGreaterThan(25);
  });

  it("is the geometry's own stretch, every vertex on the ground it is given, as high over it as it says: the ground the players stand on, the walkable rock with it", () => {
    // A ground that rises with x, as a rock's plate rises out of the bare ground.
    const ground = (x: number, z: number): number => 7 + 0.25 * x + 0.5 * z;
    const way = straight(10);
    const { data } = stood(way, ground, 0, 9);
    expect(data.positions.length / 3).toBe(10 * WAY_POINT_VERTICES);
    expect(data.light.length).toBe(10 * WAY_POINT_VERTICES * WAY_LIGHT_FLOATS);
    for (let v = 0; v < data.positions.length / 3; v++) {
      expect(data.positions[v * 3 + 1]).toBeCloseTo(ground(data.positions[v * 3]!, data.positions[v * 3 + 2]!) + WAY_LIFT_M + data.light[v * WAY_LIGHT_FLOATS + 1]!, 3);
    }
    // What the geometry lays out at once, in slices: the same numbers and the same triangles.
    const whole = wayChunk(way, ground, 0, 9);
    expect([...data.indices]).toEqual([...whole.indices]);
    expect([...data.light]).toEqual([...whole.light]);
    for (let i = 0; i < whole.positions.length; i++) expect(data.positions[i]).toBeCloseTo(whole.positions[i]!, 3);
  });
});
