import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import type { SignPost } from "../../src/sim/signs.js";
import { createSignMeshes, squareInnerEnd } from "../../src/game/signMeshes.js";
import {
  ARM_THICKNESS, LABEL_LIFT, LABEL_SIZE, POST_HEIGHT, SIGN_ARM_OUTPUT, faceNormals, labelAlong, plankCount, postHeight, signPlaces, squareEnd,
} from "../../src/game/signParts.js";

registerBuiltInLoaders();

let engine: NullEngine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});
function freshScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}
function diskLoader(scene: Scene) {
  return (output: string): Promise<AssetContainer> => {
    const bytes = readFileSync(new URL(`../../assets/${output}`, import.meta.url));
    return loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
  };
}

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
    const theirs: number[] = [];
    VertexData.ComputeNormals(Array.from(positions), indices, theirs);
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

  it("cuts the shipped arm, every level of it, as the cut worked out with Babylon.js's own normals does", async () => {
    const scene = freshScene();
    const container = await diskLoader(scene)(SIGN_ARM_OUTPUT);
    let cuts = 0;
    for (const mesh of container.meshes) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      const indices = mesh.getIndices();
      const oldNormals = mesh.getVerticesData(VertexBuffer.NormalKind);
      if (positions === null || indices === null || oldNormals === null || positions.length === 0) continue;
      // The cut as the shell had it before the plain module: Babylon.js's own normals over the moved positions.
      let cut = Infinity;
      for (let i = 0; i < positions.length; i += 3) if (Math.abs(positions[i + 1] as number) < 1e-4) cut = Math.min(cut, positions[i + 2] as number);
      const moved = new Set<number>();
      const next = Array.from(positions);
      for (let v = 0; v < next.length / 3; v++) {
        if ((next[3 * v + 2] as number) < cut) {
          next[3 * v + 2] = cut;
          moved.add(v);
        }
      }
      const fresh: number[] = [];
      VertexData.ComputeNormals(next, indices, fresh);
      let agree = 0;
      for (let v = 0; v < next.length / 3; v++) {
        if (moved.has(v)) continue;
        for (let k = 0; k < 3; k++) agree += (fresh[3 * v + k] as number) * (oldNormals[3 * v + k] as number);
      }
      const sign = agree < 0 ? -1 : 1;
      const normals = Array.from(oldNormals);
      for (let t = 0; t < indices.length; t += 3) {
        const tri = [indices[t], indices[t + 1], indices[t + 2]] as number[];
        if (!tri.some((v) => moved.has(v))) continue;
        for (const v of tri) {
          const n = [fresh[3 * v] as number, fresh[3 * v + 1] as number, fresh[3 * v + 2] as number];
          if (Math.hypot(n[0] as number, n[1] as number, n[2] as number) < 0.5) continue;
          for (let k = 0; k < 3; k++) normals[3 * v + k] = sign * (n[k] as number);
        }
      }
      const geometry = { positions: Float32Array.from(positions), normals: Float32Array.from(oldNormals), indices };
      expect(squareEnd(geometry)).toEqual({ end: cut, moved: moved.size });
      expect(Array.from(geometry.positions)).toEqual(Array.from(Float32Array.from(next)));
      expect(Array.from(geometry.normals)).toEqual(Array.from(Float32Array.from(normals)));
      expect(moved.size).toBeGreaterThan(0);
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

  it("stands every plank and every face of its lettering where the shell on Babylon.js stands them", async () => {
    const scene = freshScene();
    const signs = createSignMeshes(scene, POSTS, groundH, {
      materialFor: (name) => new StandardMaterial(`box_${name}`, scene),
      paint: (s, name) => new PBRMaterial(name, s),
      loader: diskLoader(scene),
    });
    await signs.ready;
    // The plank's end as the shell found it: the same cut on a container of its own.
    const end = squareInnerEnd(await diskLoader(scene)(SIGN_ARM_OUTPUT));
    const places = signPlaces(POSTS, groundH, end);
    let plank = 0;
    for (const [p, post] of POSTS.entries()) {
      for (const arm of post.arms) {
        for (const rank of arm.ranks) {
          const name = `sign_${p}_plank_${rank}`;
          const node = scene.getTransformNodeByName(name);
          if (node === null) throw new Error(`no ${name}`);
          const theirs = node.computeWorldMatrix(true).m;
          const ours = places.plankMatrices.subarray(plank * 16, plank * 16 + 16);
          for (let i = 0; i < 16; i++) expect(ours[i]).toBeCloseTo(theirs[i] as number, 4);
          for (const [f, side] of (["px", "nx"] as const).entries()) {
            const plane = scene.getMeshByName(`${name}_label_${side}`) as AbstractMesh;
            const world = plane.computeWorldMatrix(true);
            const positions = plane.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
            const uvs = plane.getVerticesData(VertexBuffer.UVKind) as Float32Array;
            const face = places.labels[plank * 2 + f] as (typeof places.labels)[number];
            // The plane's corners by their texture coordinates: (0, 0) the bottom left as the face is read.
            for (const [c, [u, v]] of ([[0, 0], [1, 0], [1, 1], [0, 1]] as const).entries()) {
              let at = -1;
              for (let i = 0; i < 4; i++) if (uvs[i * 2] === u && uvs[i * 2 + 1] === v) at = i;
              const corner = Vector3.TransformCoordinates(new Vector3(positions[at * 3], positions[at * 3 + 1], positions[at * 3 + 2]), world);
              expect(face.corners[c * 3]).toBeCloseTo(corner.x, 4);
              expect(face.corners[c * 3 + 1]).toBeCloseTo(corner.y, 4);
              expect(face.corners[c * 3 + 2]).toBeCloseTo(corner.z, 4);
            }
            const out = Vector3.TransformNormal(new Vector3(0, 0, -1), world).normalize();
            expect(face.normal.x).toBeCloseTo(out.x, 5);
            expect(face.normal.y).toBeCloseTo(out.y, 5);
            expect(face.normal.z).toBeCloseTo(out.z, 5);
          }
          plank++;
        }
      }
    }
    expect(plank).toBe(5);
    signs.dispose();
  });

  it("lays a face's lettering a millimetre off its plank's face, centred on the board seen past the post", () => {
    const places = signPlaces([{ x: 0, z: 0, arms: [{ dx: 0, dz: 1, names: ["Summit"], ranks: [0] }] }], () => 0, 0.05);
    const inverse = Matrix.FromArray(places.plankMatrices).invert();
    for (const [f, side] of [1, -1].entries()) {
      const face = places.labels[f] as (typeof places.labels)[number];
      let cx = 0, cz = 0;
      for (let c = 0; c < 4; c++) {
        const local = Vector3.TransformCoordinates(new Vector3(face.corners[c * 3], face.corners[c * 3 + 1], face.corners[c * 3 + 2]), inverse);
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
