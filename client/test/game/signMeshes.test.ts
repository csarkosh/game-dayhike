import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import type { SignPost } from "../../src/sim/signs.js";
import { armYaw, createSignMeshes, plankCount, plankHeight, postHeight } from "../../src/game/signMeshes.js";

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

/** The shipped GLBs, read from disk the way catalogModels.test.ts does. */
function diskLoader(scene: Scene) {
  return (output: string): Promise<AssetContainer> => {
    const bytes = readFileSync(new URL(`../../assets/${output}`, import.meta.url));
    return loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
  };
}

/** A loader that holds every file until `release` is called. */
function gatedLoader(scene: Scene) {
  const inner = diskLoader(scene);
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  return {
    loader: async (output: string) => {
      await gate;
      return inner(output);
    },
    release: () => open(),
  };
}

const C20 = Math.cos(Math.PI / 9), S20 = Math.sin(Math.PI / 9);
const R2 = Math.SQRT1_2;
/**
 * A three-way post at (100, 50) with four planks: two east, one west, and one
 * on an arm 20 degrees off the east one, close enough that two boards at one
 * height would cross. A two-way post at the origin with three planks, and a
 * one-plank post at (-50, 0) pointing on the diagonal.
 */
const POSTS: SignPost[] = [
  {
    x: 100, z: 50, arms: [
      { dx: 1, dz: 0, names: ["Summit", "Trailhead"], ranks: [0, 3] },
      { dx: -1, dz: 0, names: ["Old Lake"], ranks: [1] },
      { dx: C20, dz: S20, names: ["Bear Meadow"], ranks: [2] },
    ],
  },
  {
    x: 0, z: 0, arms: [
      { dx: 0, dz: 1, names: ["Summit"], ranks: [0] },
      { dx: 0, dz: -1, names: ["Trailhead", "Fern Meadow"], ranks: [1, 2] },
    ],
  },
  { x: -50, z: 0, arms: [{ dx: R2, dz: R2, names: ["Trailhead"], ranks: [0] }] },
];
/** Every plank's node, post by post, top plank first. */
const PLANKS = [
  "sign_0_plank_0", "sign_0_plank_1", "sign_0_plank_2", "sign_0_plank_3",
  "sign_1_plank_0", "sign_1_plank_1", "sign_1_plank_2", "sign_2_plank_0",
];
const groundH = (): number => 2;

function setup(scene: Scene, loader: (output: string) => Promise<AssetContainer>) {
  const painted: { name: string; text: string; width: number; height: number; material: Material }[] = [];
  const shadowed = new Set<AbstractMesh>();
  const boxMaterials: string[] = [];
  const signs = createSignMeshes(scene, POSTS, groundH, {
    materialFor: (name) => {
      boxMaterials.push(name);
      return new StandardMaterial(`box_${name}`, scene);
    },
    // A NullEngine has no canvas to paint on; the painter is the one part
    // of this that needs a browser.
    paint: (s, name, text, width, height) => {
      const material = new PBRMaterial(name, s);
      painted.push({ name, text, width, height, material });
      return material;
    },
    shadows: { add: (m) => shadowed.add(m), remove: (m) => shadowed.delete(m) },
    loader,
  });
  return { signs, painted, shadowed, boxMaterials };
}

function node(scene: Scene, name: string): TransformNode {
  const found = scene.getTransformNodeByName(name);
  if (found === null) throw new Error(`no ${name}`);
  return found;
}

/** The meshes with geometry under a placed model. */
function drawn(root: TransformNode): AbstractMesh[] {
  return root.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0 && !m.name.includes("_label_"));
}

/** Every vertex of a mesh in world space, with its UV. */
/** World matrices are single precision, so world positions hold to about 1e-5. */
function worldVertices(mesh: AbstractMesh): { p: Vector3; u: number; v: number }[] {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind) as number[] | Float32Array;
  const uv = mesh.getVerticesData(VertexBuffer.UVKind) ?? [];
  const world = mesh.computeWorldMatrix(true);
  const out: { p: Vector3; u: number; v: number }[] = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const p = Vector3.TransformCoordinates(new Vector3(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]), world);
    out.push({ p, u: uv[2 * i] ?? Number.NaN, v: uv[2 * i + 1] ?? Number.NaN });
  }
  return out;
}

describe("armYaw", () => {
  it("turns an arm's unit direction into the yaw the sim convention uses (0 faces +z, PI/2 faces +x)", () => {
    expect(armYaw({ dx: 0, dz: 1 })).toBeCloseTo(0, 9);
    expect(armYaw({ dx: 1, dz: 0 })).toBeCloseTo(Math.PI / 2, 9);
    expect(armYaw({ dx: -1, dz: 0 })).toBeCloseTo(-Math.PI / 2, 9);
  });
});

describe("plank heights", () => {
  it("counts a plank per name across a post's arms", () => {
    expect(POSTS.map(plankCount)).toEqual([4, 3, 1]);
  });

  it("stacks a post's planks 0.215 m apart from the top down, the bottom one's centre at 1.75 m", () => {
    expect([0, 1, 2].map((r) => +plankHeight(r, 3).toFixed(6))).toEqual([2.18, 1.965, 1.75]);
    expect(plankHeight(0, 1)).toBe(1.75);
    // The bottom board's lower edge, half its 0.204 m height below, clears a 1.6 m eye.
    expect(plankHeight(2, 3) - 0.102).toBeGreaterThan(1.6);
  });

  it("stretches the post to stand 0.1 m over its highest plank, never shorter than the model's 2.221 m", () => {
    expect(postHeight(0)).toBe(2.221);
    expect(postHeight(1)).toBe(2.221);
    expect(postHeight(2)).toBe(2.221);
    expect(+postHeight(3).toFixed(6)).toBe(2.382);
    expect(+postHeight(4).toFixed(6)).toBe(2.597);
  });
});

describe("createSignMeshes", () => {
  it("draws each post's collider box until the models arrive, then a post per junction and a plank per name", async () => {
    const scene = freshScene();
    const gate = gatedLoader(scene);
    const { signs, shadowed, boxMaterials } = setup(scene, gate.loader);

    const box = scene.getMeshByName("sign_0_box") as Mesh;
    expect(scene.getMeshByName("sign_1_box")).not.toBeNull();
    expect(scene.getMeshByName("sign_2_box")).not.toBeNull();
    expect(boxMaterials).toEqual(["signpost", "signpost", "signpost"]);
    // The sim's box: 0.2 x 2.2 x 0.2, standing on the ground.
    const extent = box.getBoundingInfo().boundingBox.extendSize;
    expect([extent.x, extent.y, extent.z].map((v) => +v.toFixed(6))).toEqual([0.1, 1.1, 0.1]);
    expect([box.position.x, box.position.y, box.position.z]).toEqual([100, 3.1, 50]);
    expect(shadowed.size).toBe(3);

    gate.release();
    await signs.ready;

    expect(scene.getMeshByName("sign_0_box")).toBeNull();
    expect(scene.getMeshByName("sign_1_box")).toBeNull();
    expect(scene.getMeshByName("sign_2_box")).toBeNull();
    expect(shadowed.has(box)).toBe(false);

    // Stretched to stand 0.1 m over the top plank: 2.597 m over four, 2.382
    // m over three, and the model's own 2.221 m over one.
    const tops = [4.597, 4.382, 4.221];
    for (const p of [0, 1, 2]) {
      const post = node(scene, `sign_${p}_post`);
      post.computeWorldMatrix(true);
      expect(post.getAbsolutePosition().asArray()).toEqual([POSTS[p]!.x, 2, POSTS[p]!.z]);
      // Only the first level is copied, and it is on.
      expect(scene.getTransformNodeByName(`sign_${p}_post_LOD0`)!.isEnabled()).toBe(true);
      expect(scene.getTransformNodeByName(`sign_${p}_post_LOD1`)).toBeNull();
      expect(scene.getTransformNodeByName(`sign_${p}_post_LOD2`)).toBeNull();
      // Its foot on the ground, its top where the planks need it.
      const meshes = drawn(post);
      expect(meshes.length).toBeGreaterThan(0);
      const ys = meshes.flatMap((m) => worldVertices(m).map(({ p: v }) => v.y));
      expect(Math.min(...ys)).toBeCloseTo(2, 3);
      expect(Math.max(...ys)).toBeCloseTo(tops[p]!, 2);
    }
    // Eight planks in all, one per name, each one copy of the same model.
    const arms = PLANKS.map((n) => node(scene, n));
    expect(scene.getTransformNodeByName("sign_0_plank_4")).toBeNull();
    expect(scene.getTransformNodeByName("sign_2_plank_1")).toBeNull();
    for (const [i, arm] of arms.entries()) {
      expect(scene.getTransformNodeByName(`${arm.name}_LOD0`)!.isEnabled()).toBe(true);
      expect(scene.getTransformNodeByName(`${arm.name}_LOD1`)).toBeNull();
      const meshes = drawn(arm) as Mesh[];
      expect(meshes.length).toBeGreaterThan(0);
      for (const m of meshes) expect(shadowed.has(m)).toBe(true);
      // Shared geometry: every arm draws the first arm's buffers.
      if (i > 0) expect(meshes[0]!.geometry).toBe((drawn(arms[0]!) as Mesh[])[0]!.geometry);
    }
    signs.dispose();
    expect(shadowed.size).toBe(0);
    expect(scene.getTransformNodeByName("sign_0_post")).toBeNull();
    expect(scene.meshes.filter((m) => m.getTotalVertices() > 0)).toHaveLength(0);
  });

  it("turns each plank's tip along its branch, its post end pushed 0.092 m past the post's axis", async () => {
    const scene = freshScene();
    const { signs } = setup(scene, diskLoader(scene));
    await signs.ready;

    // The top plank of four: 1.75 + 3 x 0.215 over the ground at 2.
    const east = node(scene, "sign_0_plank_0");
    expect(east.rotation.y).toBeCloseTo(1.5707963, 4);
    east.computeWorldMatrix(true);
    const at = east.getAbsolutePosition();
    // Pushed back through the post's axis, the footing's origin.
    expect(at.x).toBeCloseTo(99.908, 4);
    expect(at.y).toBeCloseTo(4.395, 4);
    expect(at.z).toBeCloseTo(50, 4);
    // The arrow's tip 1.095 m on from the post end, at the arm's centre height.
    const verts = drawn(east).flatMap((m) => worldVertices(m).map(({ p }) => p));
    const tip = verts.reduce((a, b) => (b.x > a.x ? b : a));
    expect(tip.x).toBeCloseTo(101.004, 2);
    expect(tip.y).toBeCloseTo(4.395, 2);
    // The point is an edge across the board's thickness, 0.019 m either side of the centre line.
    expect(Math.abs(tip.z - 50)).toBeLessThanOrEqual(0.02);
    // The post end square across the arm, 0.204 m tall and 0.038 m thick.
    expect(Math.min(...verts.map((p) => p.x))).toBeCloseTo(99.908, 3);
    expect(Math.max(...verts.map((p) => p.y)) - Math.min(...verts.map((p) => p.y))).toBeCloseTo(0.204, 2);
    expect(Math.max(...verts.map((p) => p.z)) - Math.min(...verts.map((p) => p.z))).toBeCloseTo(0.038, 2);

    const west = node(scene, "sign_0_plank_1");
    expect(west.rotation.y).toBeCloseTo(-1.5707963, 4);
    const westVerts = drawn(west).flatMap((m) => worldVertices(m).map(({ p }) => p));
    expect(Math.min(...westVerts.map((p) => p.x))).toBeCloseTo(98.996, 2);

    // The post at the origin points its top plank north: its tip at z = 1.096 - 0.092.
    const north = drawn(node(scene, "sign_1_plank_0")).flatMap((m) => worldVertices(m).map(({ p }) => p));
    expect(Math.max(...north.map((p) => p.z))).toBeCloseTo(1.004, 2);
    // The diagonal plank at (-50, 0): its tip 1.004 m out, 0.71 m on each axis.
    const diagonal = drawn(node(scene, "sign_2_plank_0")).flatMap((m) => worldVertices(m).map(({ p }) => p));
    const out = diagonal.map((p) => (p.x + 50) * R2 + p.z * R2);
    expect(Math.max(...out)).toBeCloseTo(1.004, 2);
    const far = diagonal[out.indexOf(Math.max(...out))]!;
    // The tip edge runs across the board's thickness, 0.019 m either side of the diagonal.
    expect((far.x + 50 + far.z) / 2).toBeCloseTo(0.71, 2);
    signs.dispose();
  });

  it("closes every plank's notch inside the post, square on or on the diagonal", async () => {
    const scene = freshScene();
    const { signs } = setup(scene, diskLoader(scene));
    await signs.ready;
    // The post model as drawn: 0.134 m by 0.126 m at its foot, its axis
    // within 6 mm of the footing's origin, narrowing up the shaft.
    const post = drawn(node(scene, "sign_2_post")).flatMap((m) => worldVertices(m).map(({ p }) => p));
    const foot = post.filter((p) => p.y < 2.3);
    expect([Math.min(...foot.map((p) => p.x)), Math.max(...foot.map((p) => p.x))].map((v) => +(v + 50).toFixed(3))).toEqual([-0.067, 0.061]);
    expect([Math.min(...foot.map((p) => p.z)), Math.max(...foot.map((p) => p.z))].map((v) => +v.toFixed(3))).toEqual([-0.063, 0.063]);
    for (const [p, where] of POSTS.entries()) {
      // The post's surface as world-space triangles.
      const triangles = drawn(node(scene, `sign_${p}_post`)).flatMap((m) => {
        const verts = worldVertices(m).map(({ p: v }) => v);
        const index = m.getIndices() ?? [];
        const out: [Vector3, Vector3, Vector3][] = [];
        for (let i = 0; i + 2 < index.length; i += 3) out.push([verts[index[i]!]!, verts[index[i + 1]!]!, verts[index[i + 2]!]!]);
        return out;
      });
      const hits = (from: Vector3, dir: Vector3): boolean =>
        triangles.some(([a, b, c]) => {
          const e1 = b.subtract(a), e2 = c.subtract(a);
          const h = Vector3.Cross(dir, e2);
          const det = Vector3.Dot(e1, h);
          if (Math.abs(det) < 1e-12) return false;
          const q = from.subtract(a);
          const u = Vector3.Dot(q, h) / det;
          if (u < 0 || u > 1) return false;
          const r = Vector3.Cross(q, e1);
          const v = Vector3.Dot(dir, r) / det;
          return v >= 0 && u + v <= 1 && Vector3.Dot(e2, r) / det > 0;
        });
      // Inside the post: a level ray from the point meets its surface
      // whichever of eight ways it leaves.
      const inside = (at: Vector3): boolean =>
        [[1, 0], [R2, R2], [0, 1], [-R2, R2], [-1, 0], [-R2, -R2], [0, -1], [R2, -R2]].every(([x, z]) => hits(at, new Vector3(x, 0, z)));
      expect(inside(new Vector3(where.x, 3, where.z))).toBe(true);
      expect(inside(new Vector3(where.x + 0.2, 3, where.z))).toBe(false);
      for (const arm of where.arms) {
        for (const rank of arm.ranks) {
          const plank = drawn(node(scene, `sign_${p}_plank_${rank}`)).flatMap((m) => worldVertices(m).map(({ p: v }) => v));
          const reach = plank.map((v) => (v.x - where.x) * arm.dx + (v.z - where.z) * arm.dz);
          const at = `sign_${p}_plank_${rank}`;
          // The notch's corners 0.092 m back through the post's axis, its
          // apex 0.1285 m on from them, on the board's centre line.
          expect(Math.min(...reach), at).toBeCloseTo(-0.092, 3);
          const centre = 2 + plankHeight(rank, plankCount(where));
          const apex = plank.filter((v, i) => Math.abs(reach[i]! - 0.0365) < 1e-3 && Math.abs(v.y - centre) < 1e-3);
          // Two points, one on each face, each shared by several of the model's vertices.
          expect(new Set(apex.map((v) => v.asArray().map((c) => c.toFixed(4)).join())).size, at).toBe(2);
          const corners = plank.filter((_, i) => reach[i]! < -0.091);
          expect(corners.length, at).toBeGreaterThan(0);
          const toward = new Vector3(arm.dx, 0, arm.dz);
          for (const v of apex) {
            // At least 5 mm inside the post, whichever way the surface is.
            expect(inside(v), at).toBe(true);
            for (const [x, z] of [[1, 0], [R2, R2], [0, 1], [-R2, R2], [-1, 0], [-R2, -R2], [0, -1], [R2, -R2]]) {
              expect(inside(v.add(new Vector3(x! * 0.005, 0, z! * 0.005))), at).toBe(true);
            }
          }
          // The notch is deeper than the post is wide, so its points come out
          // of the far face, but by no more than 0.05 m along the plank.
          for (const v of corners) {
            expect(inside(v), at).toBe(false);
            expect(inside(v.add(toward.scale(0.05))), at).toBe(true);
          }
        }
      }
    }
    signs.dispose();
  });

  it("gives every plank of a post its own height, in the post's order from the top, so no two boards cross", async () => {
    const scene = freshScene();
    const { signs } = setup(scene, diskLoader(scene));
    await signs.ready;
    const heightOf = (name: string): number => {
      const n = node(scene, name);
      n.computeWorldMatrix(true);
      return n.getAbsolutePosition().y;
    };
    // Four planks over the ground at 2: 2 + 1.75 + 0.215 per step.
    expect(heightOf("sign_0_plank_0")).toBeCloseTo(4.395, 4);
    expect(heightOf("sign_0_plank_1")).toBeCloseTo(4.18, 4);
    expect(heightOf("sign_0_plank_2")).toBeCloseTo(3.965, 4);
    expect(heightOf("sign_0_plank_3")).toBeCloseTo(3.75, 4);
    // Three planks: the Summit north on top, two south below it.
    expect(heightOf("sign_1_plank_0")).toBeCloseTo(4.18, 4);
    expect(heightOf("sign_1_plank_1")).toBeCloseTo(3.965, 4);
    expect(heightOf("sign_1_plank_2")).toBeCloseTo(3.75, 4);
    expect(Math.abs(node(scene, "sign_1_plank_1").rotation.y)).toBeCloseTo(3.1415927, 4);
    expect(Math.abs(node(scene, "sign_1_plank_2").rotation.y)).toBeCloseTo(3.1415927, 4);
    // One plank alone at the base.
    expect(heightOf("sign_2_plank_0")).toBeCloseTo(3.75, 4);
    // The east arm's second plank sits under the plank 20 degrees off it, not through it,
    // both pushed the same 0.092 m through the post.
    const off = node(scene, "sign_0_plank_2");
    expect(off.getAbsolutePosition().subtract(new Vector3(100, 3.965, 50)).length()).toBeCloseTo(0.092, 4);
    expect(off.rotation.y).toBeCloseTo(1.2217305, 4);
    expect(node(scene, "sign_0_plank_3").rotation.y).toBeCloseTo(1.5707963, 4);
    signs.dispose();
  });

  it("letters every plank on both faces with its one name, 1024 by 192, each face upright and unmirrored seen from outside", async () => {
    const scene = freshScene();
    const { signs, painted, shadowed } = setup(scene, diskLoader(scene));
    await signs.ready;
    // One lettering per place name, painted once and shared by every plank
    // naming it, on every post.
    expect(painted.map(({ name, text, width, height }) => ({ name, text, width, height }))).toEqual([
      { name: "sign_label_0", text: "Summit", width: 1024, height: 192 },
      { name: "sign_label_1", text: "Trailhead", width: 1024, height: 192 },
      { name: "sign_label_2", text: "Old Lake", width: 1024, height: 192 },
      { name: "sign_label_3", text: "Bear Meadow", width: 1024, height: 192 },
      { name: "sign_label_4", text: "Fern Meadow", width: 1024, height: 192 },
    ]);
    const textOf = new Map<string, string>(POSTS.flatMap((post, p) => post.arms.flatMap((a) => a.names.map((n, k) => [`sign_${p}_plank_${a.ranks[k]}`, n] as const))));
    const materialOf = (plank: string): Material => scene.getMeshByName(`${plank}_label_px`)!.material!;
    // Trailhead on three posts, the Summit on two: each one material.
    expect(materialOf("sign_0_plank_3")).toBe(materialOf("sign_1_plank_1"));
    expect(materialOf("sign_0_plank_3")).toBe(materialOf("sign_2_plank_0"));
    expect(materialOf("sign_0_plank_0")).toBe(materialOf("sign_1_plank_0"));
    expect(materialOf("sign_0_plank_0")).not.toBe(materialOf("sign_0_plank_3"));

    for (const arm of PLANKS) {
      const labels = scene.meshes.filter((m) => m.name.startsWith(`${arm}_label_`));
      expect(labels.map((m) => m.name).sort()).toEqual([`${arm}_label_nx`, `${arm}_label_px`]);
      const armNode = node(scene, arm);
      const along = new Vector3(Math.sin(armNode.rotation.y), 0, Math.cos(armNode.rotation.y));
      for (const label of labels) {
        expect(label.material).toBe(painted.find((p) => p.text === textOf.get(arm))!.material);
        expect(label.material!.backFaceCulling).toBe(true);
        expect(shadowed.has(label)).toBe(false);
        expect(label.receiveShadows).toBe(true);
        const verts = worldVertices(label);
        // 0.76 m by 0.1425 m.
        const ys = verts.map(({ p }) => p.y);
        expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.1425, 4);
        const centre = verts.reduce((s, { p }) => s.addInPlace(p), Vector3.Zero()).scaleInPlace(1 / verts.length);
        const normals = label.getVerticesData(VertexBuffer.NormalKind)!;
        const normal = Vector3.TransformNormal(new Vector3(normals[0], normals[1], normals[2]), label.computeWorldMatrix(true)).normalize();
        // Out of the arm's face, square to the arm, 1 mm off the 0.038 m board.
        const armAt = armNode.getAbsolutePosition();
        const offset = centre.subtract(armAt);
        expect(Vector3.Dot(normal, offset)).toBeCloseTo(0.02, 4);
        expect(Vector3.Dot(normal, along)).toBeCloseTo(0, 4);
        // 0.4765 m out from the post's axis, 0.5685 m from the plank's pushed-in end:
        // the middle of the board seen between the post and the arrow's point.
        expect(Vector3.Dot(offset, along)).toBeCloseTo(0.5685, 4);
        // Seen from outside, looking back along -normal: u runs to the
        // viewer's right and v up, where a painted canvas's top row lands.
        const right = Vector3.Cross(Vector3.Up(), normal.scale(-1));
        const u0 = verts.filter(({ u }) => u === 0).map(({ p }) => p);
        const u1 = verts.filter(({ u }) => u === 1).map(({ p }) => p);
        expect(Vector3.Dot(u1[0]!.subtract(u0[0]!), right)).toBeCloseTo(0.76, 4);
        const v0 = verts.filter(({ v }) => v === 0).map(({ p }) => p.y);
        const v1 = verts.filter(({ v }) => v === 1).map(({ p }) => p.y);
        expect(Math.min(...v1) - Math.max(...v0)).toBeCloseTo(0.1425, 4);
      }
    }
    for (const { material } of painted) expect(scene.materials).toContain(material);
    signs.dispose();
    expect(scene.meshes.filter((m) => m.name.includes("_label_"))).toHaveLength(0);
    // Each shared lettering disposed once, with its planks gone.
    for (const { material } of painted) expect(scene.materials).not.toContain(material);
  });

  it("raises the post's and the arms' light cap to one lamp per hiker plus the sun and fill", async () => {
    const scene = freshScene();
    const { signs } = setup(scene, diskLoader(scene));
    await signs.ready;
    for (const name of ["sign_0_post", "sign_1_post", "sign_0_plank_0", "sign_1_plank_2"]) {
      const materials = drawn(node(scene, name)).flatMap((m) => (m.material === null ? [] : [m.material]));
      expect(materials.length).toBeGreaterThan(0);
      for (const m of materials) expect((m as PBRMaterial).maxSimultaneousLights).toBe(7);
    }
    signs.dispose();
  });

  it("keeps the post boxes, and letters nothing, when the models never load", async () => {
    const scene = freshScene();
    const { signs, painted, shadowed } = setup(scene, () => Promise.reject(new Error("offline")));
    await signs.ready;
    expect(scene.getMeshByName("sign_0_box")).not.toBeNull();
    expect(scene.getMeshByName("sign_1_box")).not.toBeNull();
    expect(shadowed.size).toBe(3);
    expect(painted).toHaveLength(0);
    signs.dispose();
    expect(scene.getMeshByName("sign_0_box")).toBeNull();
    expect(shadowed.size).toBe(0);
  });

  it("keeps the post boxes when only the post fails, with the planks standing off them", async () => {
    const scene = freshScene();
    const disk = diskLoader(scene);
    const { signs, painted } = setup(scene, (output) =>
      output.includes("post") ? Promise.reject(new Error("offline")) : disk(output));
    await signs.ready;
    expect(scene.getMeshByName("sign_0_box")).not.toBeNull();
    expect(scene.getTransformNodeByName("sign_0_post")).toBeNull();
    expect(scene.getTransformNodeByName("sign_0_plank_0")).not.toBeNull();
    expect(painted).toHaveLength(5);
    signs.dispose();
  });

  it("drops the models if disposed while they load", async () => {
    const scene = freshScene();
    const gate = gatedLoader(scene);
    const { signs, painted, shadowed } = setup(scene, gate.loader);
    signs.dispose();
    expect(scene.getMeshByName("sign_0_box")).toBeNull();
    gate.release();
    await signs.ready;
    expect(scene.getTransformNodeByName("sign_0_post")).toBeNull();
    expect(scene.getTransformNodeByName("sign_0_plank_0")).toBeNull();
    expect(scene.meshes.filter((m) => m.getTotalVertices() > 0)).toHaveLength(0);
    expect(painted).toHaveLength(0);
    expect(shadowed.size).toBe(0);
  });
});
