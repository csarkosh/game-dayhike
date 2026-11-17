import { describe, expect, it } from "vitest";
import { matrixMultiply } from "../../src/game/instancePose.js";
import { bakeGeometry, boundsOf, chainMatrix, mirrors, type PlacedNode } from "../../src/game/modelBake.js";
import { babylonValues } from "../helpers/babylonFixture.js";

/**
 * What Babylon.js gave, recorded: the quaternion of each node's Euler angles (`Quaternion.FromEulerAngles`, by the
 * angles), the matrix of the chain below as it multiplies a child's by its parent's, and two composed matrices.
 */
const BABYLON = babylonValues<{ quats: Record<string, number[]>; chain: number[]; a: number[]; b: number[] }>("numbers/modelBake.json");
const turned = (euler: [number, number, number]): PlacedNode["rotationQuaternion"] => {
  const q = BABYLON.quats[euler.join(",")];
  if (q === undefined) throw new Error(`no quaternion recorded for the angles ${euler.join(", ")}`);
  return { x: q[0] as number, y: q[1] as number, z: q[2] as number, w: q[3] as number };
};

const node = (position: [number, number, number], euler: [number, number, number], scaling: [number, number, number]): PlacedNode => ({
  position: { x: position[0], y: position[1], z: position[2] },
  rotationQuaternion: turned(euler),
  scaling: { x: scaling[0], y: scaling[1], z: scaling[2] },
});
/** A glTF loader's root in a left-handed scene: the mirror across x. */
const ROOT = node([0, 0, 0], [0, 0, 0], [-1, 1, 1]);

/** One triangle in the plane z = 0 facing +z, with its normal and a tangent along +x. */
const triangle = (): { positions: Float32Array; normals: Float32Array; tangents: Float32Array; indices: Uint32Array } => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  tangents: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, -1]),
  indices: new Uint32Array([0, 1, 2]),
});

describe("a loaded model's geometry stood where its nodes put it", () => {
  it("multiplies a chain of nodes root first, as Babylon multiplies a child's matrix by its parent's", () => {
    const chain = [ROOT, node([1, 2, 3], [0.2, -0.7, 0.4], [2, 2, 2]), node([-4, 0.5, 9], [1.1, 0.3, -0.2], [1, 1, 1])];
    // Babylon's row vectors: a child's world is its local (`Matrix.Compose` of its scale, turn and place) times its parent's.
    const want = BABYLON.chain;
    expect(want).toHaveLength(16);
    const got = chainMatrix(chain);
    for (let i = 0; i < 16; i++) expect(got[i], `float ${i}`).toBeCloseTo(want[i] as number, 4);
  });

  it("multiplies into either operand", () => {
    // Two matrices Babylon.js composed: of a scale, a turn and a place each, the second a mirror.
    const a = [...BABYLON.a];
    const b = [...BABYLON.b];
    expect([a.length, b.length]).toEqual([16, 16]);
    const fresh = new Float32Array(16);
    matrixMultiply(a, b, fresh);
    const into = [...a];
    matrixMultiply(into, b, into);
    expect(into.map(Math.fround)).toEqual([...fresh]);
  });

  it("knows a mirror from a turn", () => {
    expect(mirrors(chainMatrix([ROOT]))).toBe(true);
    expect(mirrors(chainMatrix([node([3, 0, 0], [0.4, 2, 1], [2, 2, 2])]))).toBe(false);
    expect(mirrors(chainMatrix([ROOT, ROOT]))).toBe(false);
  });

  it("under the root's mirror moves each vertex across x, turns its normal and tangent with it and leaves the triangles as they are", () => {
    const g = triangle();
    bakeGeometry(chainMatrix([ROOT]), g);
    // A zero's sign means nothing to a shader: both are read as zero.
    const plain = (floats: Float32Array): number[] => [...floats].map((v) => v + 0);
    expect(plain(g.positions)).toEqual([0, 0, 0, -1, 0, 0, 0, 2, 0]);
    expect(plain(g.normals)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    // The tangent's direction is mirrored, its handedness kept.
    expect(plain(g.tangents)).toEqual([-1, 0, 0, 1, -1, 0, 0, 1, -1, 0, 0, -1]);
    expect([...g.indices]).toEqual([0, 1, 2]);
  });

  it("under a transform that does not mirror turns each triangle over", () => {
    const g = triangle();
    bakeGeometry(chainMatrix([node([10, 0, 0], [0, 0, 0], [3, 3, 3])]), g);
    expect([...g.positions]).toEqual([10, 0, 0, 13, 0, 0, 10, 6, 0]);
    // A scaled normal is made a unit one again.
    expect([...g.normals]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect([...g.indices]).toEqual([0, 2, 1]);
  });

  it("measures the box of the baked vertices", () => {
    const g = triangle();
    bakeGeometry(chainMatrix([ROOT]), g);
    expect(boundsOf(g.positions)).toEqual({ min: { x: -1, y: 0, z: 0 }, max: { x: 0, y: 2, z: 0 } });
  });
});
