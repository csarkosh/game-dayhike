import { describe, it, expect } from "vitest";
import { cameraSpacePlane, obliqueProjection, reflectionMatrix } from "@csarkosh/engine/game/mirrorView";
import { babylonValues } from "../helpers/babylonFixture.js";
import { carried, determinant, inverse, product } from "@csarkosh/engine/testing/ruler";

/** The murky lake's level (room-3) and a standing eye 1.7 m over it. */
const LEVEL = 50.79;
const EYE_Y = 52.49;

/**
 * What Babylon.js gave these tests, recorded. The matrices it made as their inputs: its own perspective at the
 * game's lens in both depth ranges, its look-at views for the eye level and pitched down 0.3, its reflection in the
 * lake's level, and a camera's own view and projection under a `NullEngine`. And every answer of its arithmetic the
 * tests measured with, in their order: each product of two matrices, each point carried by a matrix, each
 * determinant and the one inverse, with what each was asked.
 */
const BABYLON = babylonValues<{
  projection: { half: number[]; full: number[] };
  look: { pitch: number; view: number[] }[];
  reflection: number[];
  camera: { view: number[]; projection: number[]; halfZ: boolean };
  products: { a: number[]; b: number[]; out: number[] }[];
  carried: { m: number[]; p: number[]; out: number[] }[];
  determinants: { m: number[]; out: number }[];
  inverses: { m: number[]; out: number[] }[];
}>("numbers/mirrorView.json");

const floats = (values: readonly number[]): Float32Array => new Float32Array(values);

/** Babylon's own perspective at the game's lens: fov 1.4, 16:9, near 0.05, far 10000, as recorded. */
function babylonProjection(halfZ: boolean): Float32Array {
  return floats(halfZ ? BABYLON.projection.half : BABYLON.projection.full);
}

/** A camera-space point's NDC (x, y, depth) under a projection in Babylon's layout. */
function ndc(projection: Float32Array, x: number, y: number, z: number): [number, number, number] {
  const c = carried(projection, { x, y, z });
  return [c.x, c.y, c.z];
}

/** The mirrored camera's view, `reflection · view`, for an eye at (0, EYE_Y, 0) looking along +z, pitched down by `pitch`: Babylon's look-at view as recorded. */
function mirroredView(pitch: number): Float32Array {
  const look = BABYLON.look.find((l) => l.pitch === pitch);
  if (look === undefined) throw new Error(`no view recorded at pitch ${pitch}`);
  return product(reflectionMatrix(LEVEL, new Float32Array(16)), floats(look.view));
}

/** A world point's depth under the mirrored view and a projection. */
function worldDepth(view: Float32Array, projection: Float32Array, x: number, y: number, z: number): number {
  return carried(product(view, projection), { x, y, z }).z;
}

/** The plane 1.7 m under the eye in the mirrored camera's space: the kept half is below it, the eye above. */
const UNDER_EYE = [0, -1, 0, -1.7] as const;

describe("the ruler these tests measure with", () => {
  const same = (got: ArrayLike<number>, want: readonly number[]): boolean => want.every((v, i) => Object.is(got[i], Math.fround(v)));

  it("multiplies two matrices, carries a point, and takes a determinant and an inverse as Babylon.js did for every case below, bit for bit", () => {
    // Products: 2 mirrored views for the eye, 2 for the plane, 2 more and the 12 depths under them, 2 for the camera.
    // Points: 2 mirrored, 8 through each depth range's projection, the 12 depths, 1 under the camera.
    expect([BABYLON.products.length, BABYLON.carried.length, BABYLON.determinants.length, BABYLON.inverses.length]).toEqual([2 + 2 + 2 + 12 + 2, 2 + 2 * 8 + 12 + 1, 2, 1]);
    expect(BABYLON.products.filter(({ a, b, out }) => same(product(floats(a), floats(b)), out))).toHaveLength(BABYLON.products.length);
    for (const { m, p, out } of BABYLON.carried) {
      const got = carried(floats(m), { x: p[0] as number, y: p[1] as number, z: p[2] as number });
      expect([Object.is(got.x, out[0]), Object.is(got.y, out[1]), Object.is(got.z, out[2])]).toEqual([true, true, true]);
    }
    for (const { m, out } of BABYLON.determinants) expect(Object.is(determinant(floats(m)), out)).toBe(true);
    for (const { m, out } of BABYLON.inverses) {
      const got = inverse(floats(m));
      expect(got !== null && same(got, out)).toBe(true);
    }
    // Not a ruler that agrees because nothing moves: the recorded points land elsewhere than they started.
    expect(BABYLON.carried.filter(({ p, out }) => Math.hypot((out[0] as number) - (p[0] as number), (out[1] as number) - (p[1] as number), (out[2] as number) - (p[2] as number)) > 0.01).length).toBeGreaterThan(25);
  });

  it("is handed the matrices Babylon.js made at the game's lens, and the views it looked along", () => {
    expect(BABYLON.look.map((l) => l.pitch)).toEqual([0, 0.3]);
    for (const m of [BABYLON.projection.half, BABYLON.projection.full, BABYLON.reflection, BABYLON.camera.view, BABYLON.camera.projection, ...BABYLON.look.map((l) => l.view)]) expect(m).toHaveLength(16);
    // The lens: 1 / tan(0.7) up and down, over 16:9 across; the far plane's share of depth in each range.
    const half = babylonProjection(true);
    expect(half[5]).toBe(Math.fround(1 / Math.tan(0.7)));
    expect(babylonProjection(false)[5]).toBe(half[5]);
    expect(half[0]).toBe(Math.fround(1 / Math.tan(0.7) / (16 / 9)));
    expect(half[11]).toBe(1);
  });
});

describe("reflectionMatrix", () => {
  it("is the reflection in y = level, in Babylon's layout", () => {
    expect(Array.from(reflectionMatrix(LEVEL, new Float32Array(16)))).toEqual([
      1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 101.58000183105469, 0, 1,
    ]);
  });

  it("is Babylon's own ReflectionToRef for the plane y = level", () => {
    const ours = reflectionMatrix(LEVEL, new Float32Array(16));
    const theirs = floats(BABYLON.reflection);
    for (let i = 0; i < 16; i++) expect(ours[i]!, `m[${i}]`).toBeCloseTo(theirs[i]!, 5);
  });

  it("fixes a point on the plane and has determinant −1", () => {
    const m = reflectionMatrix(LEVEL, new Float32Array(16));
    const p = carried(m, { x: -97.4, y: LEVEL, z: 324 });
    expect(p.x).toBeCloseTo(-97.4, 4);
    expect(p.y).toBeCloseTo(50.79, 4);
    expect(p.z).toBeCloseTo(324, 4);
    expect(determinant(m)).toBe(-1);
  });

  it("puts a standing eye 1.7 m over the level 1.7 m under it", () => {
    const m = reflectionMatrix(LEVEL, new Float32Array(16));
    const eye = carried(m, { x: -97.4, y: EYE_Y, z: 324 });
    expect(eye.y).toBeCloseTo(49.09, 4);
    // The mirrored view's own eye: the origin of its camera space, back in the world.
    const inv = inverse(mirroredView(0));
    if (inv === null) throw new Error("the mirrored view has no inverse");
    expect(inv[13]!).toBeCloseTo(49.09, 4);
    expect(determinant(mirroredView(0))).toBeCloseTo(-1, 6);
  });
});

describe("cameraSpacePlane", () => {
  it("is the water 1.7 m under the mirrored eye, its normal toward the mirrored world, the eye on its negative side", () => {
    const c = cameraSpacePlane(mirroredView(0), LEVEL, new Float32Array(4));
    expect(c[0]!).toBeCloseTo(0, 6);
    expect(c[1]!).toBeCloseTo(-1, 6);
    expect(c[2]!).toBeCloseTo(0, 6);
    expect(c[3]!).toBeCloseTo(-1.7, 5);
  });

  it("tilts with the eye: pitched down 0.3 rad, its normal is (0, −cos 0.3, sin 0.3), meeting the axis 5.75 m ahead", () => {
    const c = cameraSpacePlane(mirroredView(0.3), LEVEL, new Float32Array(4));
    expect(c[0]!).toBeCloseTo(0, 6);
    expect(c[1]!).toBeCloseTo(-0.955336489125606, 6);
    expect(c[2]!).toBeCloseTo(0.29552020666133955, 6);
    expect(c[3]!).toBeCloseTo(-1.7, 5);
  });
});

describe("obliqueProjection", () => {
  it("[0, 1] depth: replaces the clip-z coefficients only, with λ·C", () => {
    const p = babylonProjection(true);
    const out = Array.from(obliqueProjection(p, UNDER_EYE, true, new Float32Array(16)));
    const expected = [
      0.6678235530853271, 0, 0, 0,
      0, 1.187241792678833, -1.1874817609786987, 0,
      0, 0, 0, 1,
      0, 0, -2.018718957901001, 0,
    ];
    for (let i = 0; i < 16; i++) expect(out[i]!, `m[${i}]`).toBeCloseTo(expected[i]!, 6);
    for (const i of [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15]) expect(out[i], `m[${i}]`).toBe(p[i]);
  });

  it("[−1, 1] depth: replaces the clip-z coefficients only, with λ·C − M₄", () => {
    const p = babylonProjection(false);
    const out = Array.from(obliqueProjection(p, UNDER_EYE, false, new Float32Array(16)));
    const expected = [
      0.6678235530853271, 0, 0, 0,
      0, 1.187241792678833, -2.3749635219573975, 0,
      0, 0, -1, 1,
      0, 0, -4.037437915802002, 0,
    ];
    for (let i = 0; i < 16; i++) expect(out[i]!, `m[${i}]`).toBeCloseTo(expected[i]!, 6);
    for (const i of [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15]) expect(out[i], `m[${i}]`).toBe(p[i]);
  });

  for (const [halfZ, near] of [[true, 0], [false, -1]] as const) {
    describe(halfZ ? "in [0, 1] depth" : "in [−1, 1] depth", () => {
      const m = obliqueProjection(babylonProjection(halfZ), UNDER_EYE, halfZ, new Float32Array(16));

      it(`maps points on the water to the near depth ${near}`, () => {
        for (const [x, z] of [[0, 1], [0, 10], [3, 25], [-40, 300]] as const) {
          expect(Math.abs(ndc(m, x, -1.7, z)[2] - near), `(${x}, ${z})`).toBeLessThan(1e-6);
        }
      });

      it("clips the image of a point 1 m under the water", () => {
        expect(ndc(m, 0, -0.7, 10)[2]).toBeLessThan(near);
        expect(ndc(m, 5, -1.2, 40)[2]).toBeLessThan(near);
      });

      it("keeps the image of a point 10 m over the water and 20 m ahead, inside the frustum", () => {
        const [x, y, d] = ndc(m, 0, -11.7, 20);
        expect(x).toBeCloseTo(0, 6);
        expect(y).toBeCloseTo(-0.6945364487171173, 5);
        expect(d).toBeGreaterThan(near);
        expect(d).toBeLessThan(1);
        expect(d).toBeCloseTo(halfZ ? 0.5937408822774887 : 0.1874817645549774, 5);
      });

      it("keeps a far crown at 500 m and 30 m over the water", () => {
        const d = ndc(m, 0, -31.7, 500)[2];
        expect(d).toBeGreaterThan(near);
        expect(d).toBeLessThan(1);
      });
    });
  }

  it("leaves a copy when the eye is on the kept side and the far corner is not: nothing to keep", () => {
    // The plane 5 m ahead facing the eye, its kept half the eye's: C·Q = −1 + 5/10000 < 0.
    const p = babylonProjection(false);
    expect(Array.from(obliqueProjection(p, [0, 0, -1, 5], false, new Float32Array(16)))).toEqual(Array.from(p));
  });

  it("may write over its own input", () => {
    const p = babylonProjection(false);
    const apart = Array.from(obliqueProjection(p, UNDER_EYE, false, new Float32Array(16)));
    expect(Array.from(obliqueProjection(p, UNDER_EYE, false, p))).toEqual(apart);
  });

  it("takes the plane cameraSpacePlane writes: the world's water at the near depth, under it clipped, both depth ranges", () => {
    for (const pitch of [0, 0.3]) {
      const view = mirroredView(pitch);
      const plane = cameraSpacePlane(view, LEVEL, new Float32Array(4));
      for (const [halfZ, near] of [[true, 0], [false, -1]] as const) {
        const m = obliqueProjection(babylonProjection(halfZ), plane, halfZ, new Float32Array(16));
        expect(worldDepth(view, m, 2, LEVEL, 12), `pitch ${pitch}`).toBeCloseTo(near, 4);
        expect(worldDepth(view, m, 2, LEVEL - 1, 12)).toBeLessThan(near);
        const above = worldDepth(view, m, 0, LEVEL + 10, 20);
        expect(above).toBeGreaterThan(near);
        expect(above).toBeLessThan(1);
      }
    }
  });
});

describe("the mirrored camera's projection from a camera's own matrices", () => {
  it("draws the water at the near depth under the view and projection a camera of Babylon.js had at the game's lens", () => {
    // The player's camera at (0, EYE_Y, 0), fov 1.4, near 0.05, far 10000, turned to a point 3 m down and 10 m ahead:
    // the recorded view has that eye at its origin and that point straight ahead of it.
    const eye = carried(floats(BABYLON.camera.view), { x: 0, y: EYE_Y, z: 0 });
    expect(Math.hypot(eye.x, eye.y, eye.z)).toBeLessThan(1e-4);
    const ahead = carried(floats(BABYLON.camera.view), { x: 0, y: EYE_Y - 3, z: 10 });
    expect(Math.hypot(ahead.x, ahead.y)).toBeLessThan(1e-4);
    expect(ahead.z).toBeCloseTo(Math.hypot(3, 10), 4);
    expect(BABYLON.camera.projection[5]).toBe(BABYLON.projection.full[5]);
    const view = product(reflectionMatrix(LEVEL, new Float32Array(16)), floats(BABYLON.camera.view));
    const plane = cameraSpacePlane(view, LEVEL, new Float32Array(4));
    const halfZ = BABYLON.camera.halfZ;
    expect(halfZ).toBe(false);
    const oblique = obliqueProjection(floats(BABYLON.camera.projection), plane, halfZ, new Float32Array(16));
    expect(worldDepth(view, oblique, 1, LEVEL, 8)).toBeCloseTo(-1, 4);
  });
});
