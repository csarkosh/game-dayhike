import { describe, expect, it } from "vitest";
import { SKY_PROBE_FACES, SKY_PROBE_SIZE, probeTexelDirection } from "../../src/game/skyProbeParams.js";

/**
 * Where a cube map is read for direction `d`, by the rule every GPU reads
 * one: the face of the largest component, its two coordinates from the
 * others over it (`sc`, `tc`), each from 0 to 1 across the face.
 */
function lookup(d: { x: number; y: number; z: number }): { face: number; u: number; v: number } {
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  let face: number, sc: number, tc: number, ma: number;
  if (ax >= ay && ax >= az) [face, sc, tc, ma] = d.x > 0 ? [0, -d.z, -d.y, ax] : [1, d.z, -d.y, ax];
  else if (ay >= az) [face, sc, tc, ma] = d.y > 0 ? [2, d.x, d.z, ay] : [3, d.x, -d.z, ay];
  else [face, sc, tc, ma] = d.z > 0 ? [4, d.x, -d.y, az] : [5, -d.x, -d.y, az];
  return { face, u: (sc / ma + 1) / 2, v: (tc / ma + 1) / 2 };
}

describe("the sky's probe", () => {
  it("is a cube of 128 texels a face, its six layers +x, -x, +y, -y, +z, -z", () => {
    expect(SKY_PROBE_SIZE).toBe(128);
    expect(SKY_PROBE_FACES.map((f) => [f.normal.x, f.normal.y, f.normal.z])).toEqual([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);
  });

  it("looks along each face's own axis at its centre, and every texel's way is a unit one", () => {
    for (let face = 0; face < 6; face++) {
      const centre = probeTexelDirection(face, 1, 1, 3);
      const n = SKY_PROBE_FACES[face]!.normal;
      expect([centre.x, centre.y, centre.z].map((c) => +c.toFixed(12))).toEqual([n.x, n.y, n.z].map((c) => c + 0));
      const corner = probeTexelDirection(face, 0, SKY_PROBE_SIZE - 1);
      expect(Math.hypot(corner.x, corner.y, corner.z)).toBeCloseTo(1, 12);
    }
  });

  it("lays each texel where a GPU reads the cube for its way: the same face, the same column and the same row", () => {
    const size = 16;
    for (let face = 0; face < 6; face++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const found = lookup(probeTexelDirection(face, x, y, size));
          expect(found.face, `face ${face} texel ${x},${y}`).toBe(face);
          expect(Math.floor(found.u * size)).toBe(x);
          expect(Math.floor(found.v * size)).toBe(y);
        }
      }
    }
  });

  it("names no seventh face", () => {
    expect(() => probeTexelDirection(6, 0, 0)).toThrow(/six faces/);
  });
});
