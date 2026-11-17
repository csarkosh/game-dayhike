import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { SignPost } from "../../src/sim/signs.js";
import { glbParts } from "../../src/game/glbParts.js";
import {
  ARM_THICKNESS, LABEL_LIFT, LABEL_SIZE, POST_HEIGHT, SIGN_ARM_OUTPUT, faceNormals, labelAlong, plankCount, postHeight, signPlaces, squareEnd,
} from "../../src/game/signParts.js";
import { babylonValues } from "../helpers/babylonFixture.js";
import { carried, inverse } from "../helpers/ruler.js";

/**
 * The shipped arm as Babylon.js's loader handed it, recorded: a level of detail each, its positions, normals and
 * indices, and the cut of its inner end as worked out with Babylon.js's own normals (`VertexData.ComputeNormals`
 * over the moved positions): where the cut is, how many vertices moved to it, and the cut mesh's positions and
 * normals.
 */
const ARM = babylonValues<{
  levels: { mesh: string; positions: number[]; normals: number[]; indices: number[]; cut: number; moved: number; wantPositions: number[]; wantNormals: number[] }[];
}>("numbers/signArm.json");
/**
 * What Babylon.js and the fingerposts' shell on it gave, recorded. `computeNormals`: `VertexData.ComputeNormals`
 * over the notched board below. `end` and `planks`: the shell built with the shipped models for the posts below:
 * the plank's end as it found it, and of each plank its node's matrix in the world and, for each face of its
 * lettering, the four corners of the label's plane by their texture coordinates and the way the plane looks.
 * `ruler`: a plank's matrix, Babylon.js's inverse of it, and eight points carried through that inverse.
 */
const SIGNS = babylonValues<{
  computeNormals: number[];
  end: number;
  planks: { name: string; world: number[]; faces: { side: string; corners: number[]; normal: number[] }[] }[];
  ruler: { m: number[]; inverse: number[]; carried: { p: number[]; out: number[] }[] };
}>("numbers/signParts.json");

const C20 = Math.cos(Math.PI / 9), S20 = Math.sin(Math.PI / 9);
const POSTS: SignPost[] = [
  {
    x: 100, z: 50, arms: [
      { dx: 1, dz: 0, names: ["Summit", "Trailhead"], ranks: [0, 3] },
      { dx: -1, dz: 0, names: ["Old Lake"], ranks: [1] },
      { dx: C20, dz: S20, names: ["Bear Meadow"], ranks: [2] },
    ],
  },
  { x: -50, z: 7, arms: [{ dx: Math.SQRT1_2, dz: Math.SQRT1_2, names: ["Trailhead"], ranks: [0] }] },
];
const groundH = (x: number, z: number): number => 2 + 0.01 * x - 0.03 * z;

/** A wedge-ended board: a V notch at its near end, as the arm's model has, in few enough triangles to read. */
function notched(): { positions: Float32Array; indices: number[] } {
  const positions = new Float32Array([
    // The near end: two points at z = 0 and the notch's apex on the centre line at z = 0.1.
    -0.02, -0.1, 0, -0.02, 0.1, 0, -0.02, 0, 0.1,
    0.02, -0.1, 0, 0.02, 0.1, 0, 0.02, 0, 0.1,
    // The far end.
    -0.02, -0.1, 1, -0.02, 0.1, 1, 0.02, -0.1, 1, 0.02, 0.1, 1,
  ]);
  const indices = [
    0, 2, 6, 2, 1, 7, 2, 7, 6, 3, 8, 5, 5, 9, 4, 5, 8, 9,
    0, 3, 2, 3, 5, 2, 2, 5, 1, 5, 4, 1, 0, 6, 8, 0, 8, 3, 1, 4, 9, 1, 9, 7, 6, 7, 9, 6, 9, 8,
  ];
  return { positions, indices };
}

describe("faceNormals", () => {
  it("makes a vertex's normal as Babylon.js's VertexData.ComputeNormals does, float for float", () => {
    const { positions, indices } = notched();
    const theirs = SIGNS.computeNormals;
    expect(theirs).toHaveLength(positions.length);
    expect(Array.from(faceNormals(positions, indices))).toEqual(theirs);
  });
});

describe("squareEnd", () => {
  it("moves every vertex behind the notch's apex forward to it, and says where the flat end is", () => {
    const { positions, indices } = notched();
    const normals = Float32Array.from(faceNormals(positions, indices));
    const cut = squareEnd({ positions, normals, indices });
    expect(cut).toEqual({ end: expect.closeTo(0.1, 6), moved: 4 });
    for (const v of [0, 1, 3, 4]) expect(positions[3 * v + 2]).toBeCloseTo(0.1, 6);
    // The far end and the apex stay where they were.
    expect(positions[3 * 6 + 2]).toBe(1);
    expect(positions[3 * 2 + 2]).toBeCloseTo(0.1, 6);
  });

  it("leaves a mesh with no vertex on its centre line as it is", () => {
    const positions = new Float32Array([0, 0.1, 0, 0, 0.2, 0, 0, 0.1, 1]);
    const before = positions.slice();
    expect(squareEnd({ positions, normals: null, indices: [0, 1, 2] })).toBeNull();
    expect(positions).toEqual(before);
  });

  it("cuts the shipped arm, every level of it, as the cut worked out with Babylon.js's own normals does", () => {
    // The record is of the arm the game ships: each level's mesh has as many vertices in the file.
    const file = readFileSync(new URL(`../../assets/${SIGN_ARM_OUTPUT}`, import.meta.url));
    const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    for (const level of ARM.levels) expect(glbParts(bytes, level.mesh).map((part) => part.vertices)).toEqual([level.positions.length / 3]);
    let cuts = 0;
    for (const level of ARM.levels) {
      // The cut as the shell had it before the plain module: Babylon.js's own normals over the moved positions.
      const geometry = { positions: new Float32Array(level.positions), normals: new Float32Array(level.normals), indices: level.indices };
      expect(squareEnd(geometry)).toEqual({ end: level.cut, moved: level.moved });
      expect(Array.from(geometry.positions)).toEqual(Array.from(new Float32Array(level.wantPositions)));
      expect(Array.from(geometry.normals)).toEqual(Array.from(new Float32Array(level.wantNormals)));
      expect(level.moved).toBeGreaterThan(0);
      cuts++;
    }
    // Three levels of detail, each with its own notch.
    expect(cuts).toBe(3);
  });
});

describe("signPlaces", () => {
  it("stands every post at its foot on the ground, stretched to its height, and counts its planks", () => {
    const places = signPlaces(POSTS, groundH, 0.05);
    expect(places.posts.map((p) => p.planks)).toEqual(POSTS.map(plankCount));
    expect(places.posts.map((p) => p.plank)).toEqual([0, 4]);
    for (const [p, post] of POSTS.entries()) {
      const m = places.postMatrices.subarray(p * 16, p * 16 + 16);
      expect([m[12], m[13], m[14]]).toEqual([post.x, groundH(post.x, post.z), post.z].map(Math.fround));
      expect(m[5]).toBeCloseTo(postHeight(plankCount(post)) / POST_HEIGHT, 6);
      expect([m[0], m[10]]).toEqual([1, 1]);
    }
    expect(places.names).toEqual(["Summit", "Trailhead", "Old Lake", "Bear Meadow"]);
    expect(places.labels).toHaveLength(2 * 5);
  });

  it("stands every plank and every face of its lettering where the shell on Babylon.js stands them", () => {
    // The plank's end as the shell found it: the same cut, the furthest of the arm's levels.
    const end = SIGNS.end;
    expect(end).toBe(Math.max(...ARM.levels.map((level) => level.cut)));
    const places = signPlaces(POSTS, groundH, end);
    let plank = 0;
    for (const [p, post] of POSTS.entries()) {
      for (const arm of post.arms) {
        for (const rank of arm.ranks) {
          const name = `sign_${p}_plank_${rank}`;
          const recorded = SIGNS.planks[plank];
          if (recorded === undefined || recorded.name !== name) throw new Error(`no ${name}`);
          const theirs = new Float32Array(recorded.world);
          expect(theirs).toHaveLength(16);
          const ours = places.plankMatrices.subarray(plank * 16, plank * 16 + 16);
          for (let i = 0; i < 16; i++) expect(ours[i]).toBeCloseTo(theirs[i] as number, 4);
          for (const [f, side] of (["px", "nx"] as const).entries()) {
            const plane = recorded.faces[f];
            if (plane === undefined || plane.side !== side) throw new Error(`no ${name}_label_${side}`);
            const face = places.labels[plank * 2 + f] as (typeof places.labels)[number];
            // The plane's corners by their texture coordinates: (0, 0) the bottom left as the face is read.
            expect(plane.corners).toHaveLength(12);
            for (let c = 0; c < 4; c++) {
              expect(face.corners[c * 3]).toBeCloseTo(plane.corners[c * 3] as number, 4);
              expect(face.corners[c * 3 + 1]).toBeCloseTo(plane.corners[c * 3 + 1] as number, 4);
              expect(face.corners[c * 3 + 2]).toBeCloseTo(plane.corners[c * 3 + 2] as number, 4);
            }
            expect(face.normal.x).toBeCloseTo(plane.normal[0] as number, 5);
            expect(face.normal.y).toBeCloseTo(plane.normal[1] as number, 5);
            expect(face.normal.z).toBeCloseTo(plane.normal[2] as number, 5);
          }
          plank++;
        }
      }
    }
    expect(plank).toBe(5);
    expect(SIGNS.planks).toHaveLength(5);
  });

  it("measures a plank's own frame with a ruler that undoes a matrix and carries a point as Babylon.js did, bit for bit", () => {
    const { m, inverse: theirs, carried: points } = SIGNS.ruler;
    const back = inverse(new Float32Array(m));
    if (back === null) throw new Error("the recorded matrix has no inverse");
    const want = new Float32Array(theirs);
    expect(Array.from(back, (value, i) => Object.is(value, want[i]))).toEqual(new Array(16).fill(true));
    expect(points).toHaveLength(8);
    for (const { p, out } of points) {
      const got = carried(want, { x: p[0] as number, y: p[1] as number, z: p[2] as number });
      expect([Object.is(got.x, out[0]), Object.is(got.y, out[1]), Object.is(got.z, out[2])]).toEqual([true, true, true]);
    }
    // The matrix stands a plank up a post, turned: its inverse is no copy of it.
    expect(Array.from(back).filter((value, i) => Math.abs(value - (m[i] as number)) > 0.5).length).toBeGreaterThan(0);
  });

  it("lays a face's lettering a millimetre off its plank's face, centred on the board seen past the post", () => {
    const places = signPlaces([{ x: 0, z: 0, arms: [{ dx: 0, dz: 1, names: ["Summit"], ranks: [0] }] }], () => 0, 0.05);
    const back = inverse(places.plankMatrices);
    if (back === null) throw new Error("the plank's matrix has no inverse");
    for (const [f, side] of [1, -1].entries()) {
      const face = places.labels[f] as (typeof places.labels)[number];
      let cx = 0, cz = 0;
      for (let c = 0; c < 4; c++) {
        const local = carried(back, { x: face.corners[c * 3] as number, y: face.corners[c * 3 + 1] as number, z: face.corners[c * 3 + 2] as number });
        expect(local.x).toBeCloseTo(side * (ARM_THICKNESS / 2 + LABEL_LIFT), 5);
        expect(Math.abs(local.y)).toBeCloseTo(LABEL_SIZE.height / 2, 5);
        cx += local.x / 4;
        cz += local.z / 4;
      }
      expect(cz).toBeCloseTo(labelAlong(0.05), 5);
      expect(Math.sign(cx)).toBe(side);
    }
  });
});
