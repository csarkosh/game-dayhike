import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Plane } from "@babylonjs/core/Maths/math.plane.js";
import { cameraSpacePlane, obliqueProjection, reflectionMatrix } from "../../src/game/mirrorView.js";

let engine: NullEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });

/** The murky lake's level (room-3) and a standing eye 1.7 m over it. */
const LEVEL = 50.79;
const EYE_Y = 52.49;

/** Babylon's own perspective at the game's lens: fov 1.4, 16:9, near 0.05, far 10000. */
function babylonProjection(halfZ: boolean): Float32Array {
  const p = new Matrix();
  Matrix.PerspectiveFovLHToRef(1.4, 16 / 9, 0.05, 10000, p, true, halfZ);
  return new Float32Array(p.m);
}

/** A camera-space point's NDC (x, y, depth) under a projection in Babylon's layout. */
function ndc(projection: Float32Array, x: number, y: number, z: number): [number, number, number] {
  const c = Vector3.TransformCoordinates(new Vector3(x, y, z), Matrix.FromArray(projection));
  return [c.x, c.y, c.z];
}

/** The mirrored camera's view, `reflection · view`, for an eye at (0, EYE_Y, 0) looking along +z, pitched down by `pitch`. */
function mirroredView(pitch: number): Float32Array {
  const view = new Matrix();
  const ahead = new Vector3(0, -Math.sin(pitch), Math.cos(pitch));
  const eye = new Vector3(0, EYE_Y, 0);
  Matrix.LookAtLHToRef(eye, eye.add(ahead), Vector3.Up(), view);
  return new Float32Array(Matrix.FromArray(reflectionMatrix(LEVEL, new Float32Array(16))).multiply(view).m);
}

/** A world point's depth under the mirrored view and a projection. */
function worldDepth(view: Float32Array, projection: Float32Array, x: number, y: number, z: number): number {
  const vp = Matrix.FromArray(view).multiply(Matrix.FromArray(projection));
  return Vector3.TransformCoordinates(new Vector3(x, y, z), vp).z;
}

/** The plane 1.7 m under the eye in the mirrored camera's space: the kept half is below it, the eye above. */
const UNDER_EYE = [0, -1, 0, -1.7] as const;

describe("reflectionMatrix", () => {
  it("is the reflection in y = level, in Babylon's layout", () => {
    expect(Array.from(reflectionMatrix(LEVEL, new Float32Array(16)))).toEqual([
      1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 101.58000183105469, 0, 1,
    ]);
  });

  it("is Babylon's own ReflectionToRef for the plane y = level", () => {
    const ours = reflectionMatrix(LEVEL, new Float32Array(16));
    const theirs = new Matrix();
    Matrix.ReflectionToRef(new Plane(0, 1, 0, -LEVEL), theirs);
    for (let i = 0; i < 16; i++) expect(ours[i]!, `m[${i}]`).toBeCloseTo(theirs.m[i]!, 5);
  });

  it("fixes a point on the plane and has determinant −1", () => {
    const m = Matrix.FromArray(reflectionMatrix(LEVEL, new Float32Array(16)));
    const p = Vector3.TransformCoordinates(new Vector3(-97.4, LEVEL, 324), m);
    expect(p.x).toBeCloseTo(-97.4, 4);
    expect(p.y).toBeCloseTo(50.79, 4);
    expect(p.z).toBeCloseTo(324, 4);
    expect(m.determinant()).toBe(-1);
  });

  it("puts a standing eye 1.7 m over the level 1.7 m under it", () => {
    const m = Matrix.FromArray(reflectionMatrix(LEVEL, new Float32Array(16)));
    const eye = Vector3.TransformCoordinates(new Vector3(-97.4, EYE_Y, 324), m);
    expect(eye.y).toBeCloseTo(49.09, 4);
    // The mirrored view's own eye: the origin of its camera space, back in the world.
    const inv = Matrix.FromArray(mirroredView(0)).invert();
    expect(inv.m[13]!).toBeCloseTo(49.09, 4);
    expect(Matrix.FromArray(mirroredView(0)).determinant()).toBeCloseTo(-1, 6);
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

describe("the mirrored camera in Babylon", () => {
  it("freezes the oblique projection and draws the water at the near depth", () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    const player = new UniversalCamera("player", new Vector3(0, EYE_Y, 0), scene);
    player.fov = 1.4;
    player.minZ = 0.05;
    player.maxZ = 10000;
    player.setTarget(new Vector3(0, EYE_Y - 3, 10));
    scene.activeCamera = player;
    const view = new Float32Array(16);
    Matrix.FromArray(reflectionMatrix(LEVEL, new Float32Array(16))).multiplyToArray(player.getViewMatrix(true), view, 0);
    const plane = cameraSpacePlane(view, LEVEL, new Float32Array(4));
    const halfZ = engine.isNDCHalfZRange;
    expect(halfZ).toBe(false);
    const oblique = obliqueProjection(new Float32Array(player.getProjectionMatrix(true).m), plane, halfZ, new Float32Array(16));
    const mirror = new TargetCamera("lake_mirror_cam_probe", Vector3.Zero(), scene);
    mirror.freezeProjectionMatrix(Matrix.FromArray(oblique));
    expect(Array.from(mirror.getProjectionMatrix().m)).toEqual(Array.from(oblique));
    expect(worldDepth(view, new Float32Array(mirror.getProjectionMatrix().m), 1, LEVEL, 8)).toBeCloseTo(-1, 4);
  });
});
