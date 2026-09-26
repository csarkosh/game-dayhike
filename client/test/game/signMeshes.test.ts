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
import { armLevels, armYaw, createSignMeshes } from "../../src/game/signMeshes.js";

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
/**
 * A three-way post at (100, 50): one arm east, one west, and a third 20
 * degrees off the east arm, close enough that the two boards would cross.
 * A one-arm post at the origin.
 */
const POSTS: SignPost[] = [
  {
    x: 100, z: 50, arms: [
      { dx: 1, dz: 0, names: ["Summit", "Trailhead"] },
      { dx: -1, dz: 0, names: ["Old Lake"] },
      { dx: C20, dz: S20, names: ["Bear Meadow", "Summit"] },
    ],
  },
  { x: 0, z: 0, arms: [{ dx: 0, dz: 1, names: ["Trailhead"] }] },
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

describe("armLevels", () => {
  it("raises an arm a step when it points within 30 degrees of a lower one, and only then", () => {
    expect(armLevels(POSTS[0]!.arms)).toEqual([0, 0, 1]);
    // 40 degrees apart: clear of each other at one height.
    expect(armLevels([{ dx: 1, dz: 0 }, { dx: Math.cos(0.698), dz: Math.sin(0.698) }])).toEqual([0, 0]);
    // Three nearly together stack three high.
    expect(armLevels([{ dx: 1, dz: 0 }, { dx: 1, dz: 0 }, { dx: 1, dz: 0 }])).toEqual([0, 1, 2]);
  });
});

describe("createSignMeshes", () => {
  it("draws each post's collider box until the models arrive, then a post per junction and an arm per branch", async () => {
    const scene = freshScene();
    const gate = gatedLoader(scene);
    const { signs, shadowed, boxMaterials } = setup(scene, gate.loader);

    const box = scene.getMeshByName("sign_0_box") as Mesh;
    expect(scene.getMeshByName("sign_1_box")).not.toBeNull();
    expect(boxMaterials).toEqual(["signpost", "signpost"]);
    // The sim's box: 0.2 x 2.2 x 0.2, standing on the ground.
    const extent = box.getBoundingInfo().boundingBox.extendSize;
    expect([extent.x, extent.y, extent.z].map((v) => +v.toFixed(6))).toEqual([0.1, 1.1, 0.1]);
    expect([box.position.x, box.position.y, box.position.z]).toEqual([100, 3.1, 50]);
    expect(shadowed.size).toBe(2);

    gate.release();
    await signs.ready;

    expect(scene.getMeshByName("sign_0_box")).toBeNull();
    expect(scene.getMeshByName("sign_1_box")).toBeNull();
    expect(shadowed.has(box)).toBe(false);

    for (const p of [0, 1]) {
      const post = node(scene, `sign_${p}_post`);
      post.computeWorldMatrix(true);
      expect(post.getAbsolutePosition().asArray()).toEqual([POSTS[p]!.x, 2, POSTS[p]!.z]);
      // Only the first level is copied, and it is on.
      expect(scene.getTransformNodeByName(`sign_${p}_post_LOD0`)!.isEnabled()).toBe(true);
      expect(scene.getTransformNodeByName(`sign_${p}_post_LOD1`)).toBeNull();
      expect(scene.getTransformNodeByName(`sign_${p}_post_LOD2`)).toBeNull();
      // 2.22 m tall and 0.13 m square, on the ground.
      const meshes = drawn(post);
      expect(meshes.length).toBeGreaterThan(0);
      const ys = meshes.flatMap((m) => worldVertices(m).map(({ p: v }) => v.y));
      expect(Math.min(...ys)).toBeCloseTo(2, 3);
      expect(Math.max(...ys)).toBeCloseTo(4.221, 2);
    }
    // Four arms in all, each one copy of the same model.
    const arms = ["sign_0_arm_0", "sign_0_arm_1", "sign_0_arm_2", "sign_1_arm_0"].map((n) => node(scene, n));
    expect(scene.getTransformNodeByName("sign_1_arm_1")).toBeNull();
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

  it("turns each arm's tip along its branch, its post end seated on the post's face at 1.6 m", async () => {
    const scene = freshScene();
    const { signs } = setup(scene, diskLoader(scene));
    await signs.ready;

    const east = node(scene, "sign_0_arm_0");
    expect(east.rotation.y).toBeCloseTo(1.5707963, 4);
    east.computeWorldMatrix(true);
    const at = east.getAbsolutePosition();
    // 0.065 to the post's face and 5 mm clear of it.
    expect(at.x).toBeCloseTo(100.07, 4);
    expect(at.y).toBeCloseTo(3.6, 4);
    expect(at.z).toBeCloseTo(50, 4);
    // The arrow's tip 1.095 m on from the post end, at the arm's centre height.
    const verts = drawn(east).flatMap((m) => worldVertices(m).map(({ p }) => p));
    const tip = verts.reduce((a, b) => (b.x > a.x ? b : a));
    expect(tip.x).toBeCloseTo(101.166, 2);
    expect(tip.y).toBeCloseTo(3.6, 2);
    // The point is an edge across the board's thickness, 0.019 m either side of the centre line.
    expect(Math.abs(tip.z - 50)).toBeLessThanOrEqual(0.02);
    // The post end square across the arm, 0.204 m tall and 0.038 m thick.
    expect(Math.min(...verts.map((p) => p.x))).toBeCloseTo(100.07, 3);
    expect(Math.max(...verts.map((p) => p.y)) - Math.min(...verts.map((p) => p.y))).toBeCloseTo(0.204, 2);
    expect(Math.max(...verts.map((p) => p.z)) - Math.min(...verts.map((p) => p.z))).toBeCloseTo(0.038, 2);

    const west = node(scene, "sign_0_arm_1");
    expect(west.rotation.y).toBeCloseTo(-1.5707963, 4);
    const westVerts = drawn(west).flatMap((m) => worldVertices(m).map(({ p }) => p));
    expect(Math.min(...westVerts.map((p) => p.x))).toBeCloseTo(98.834, 2);

    // The post at the origin points north: its tip at z = 0.07 + 1.096.
    const north = drawn(node(scene, "sign_1_arm_0")).flatMap((m) => worldVertices(m).map(({ p }) => p));
    expect(Math.max(...north.map((p) => p.z))).toBeCloseTo(1.166, 2);
    signs.dispose();
  });

  it("raises the arm that would cross a lower one by 0.22 m", async () => {
    const scene = freshScene();
    const { signs } = setup(scene, diskLoader(scene));
    await signs.ready;
    const raised = node(scene, "sign_0_arm_2");
    raised.computeWorldMatrix(true);
    expect(raised.getAbsolutePosition().y).toBeCloseTo(3.82, 4);
    // 20 degrees off square, the post reaches further along it: 0.065 (cos 20 + sin 20) + 0.005.
    const seat = raised.getAbsolutePosition().subtract(new Vector3(100, 3.82, 50)).length();
    expect(seat).toBeCloseTo(0.0883, 4);
    expect(raised.rotation.y).toBeCloseTo(1.2217305, 4);
    node(scene, "sign_0_arm_1").computeWorldMatrix(true);
    expect(node(scene, "sign_0_arm_1").getAbsolutePosition().y).toBeCloseTo(3.6, 4);
    signs.dispose();
  });

  it("letters every arm on both faces with its names, 1024 by 192, each face upright and unmirrored seen from outside", async () => {
    const scene = freshScene();
    const { signs, painted, shadowed } = setup(scene, diskLoader(scene));
    await signs.ready;
    expect(painted.map(({ name, text, width, height }) => ({ name, text, width, height }))).toEqual([
      { name: "sign_0_arm_0_label", text: "Summit · Trailhead", width: 1024, height: 192 },
      { name: "sign_0_arm_1_label", text: "Old Lake", width: 1024, height: 192 },
      { name: "sign_0_arm_2_label", text: "Bear Meadow · Summit", width: 1024, height: 192 },
      { name: "sign_1_arm_0_label", text: "Trailhead", width: 1024, height: 192 },
    ]);

    for (const [i, arm] of ["sign_0_arm_0", "sign_0_arm_1", "sign_0_arm_2", "sign_1_arm_0"].entries()) {
      const labels = scene.meshes.filter((m) => m.name.startsWith(`${arm}_label_`));
      expect(labels.map((m) => m.name).sort()).toEqual([`${arm}_label_nx`, `${arm}_label_px`]);
      const armNode = node(scene, arm);
      const along = new Vector3(Math.sin(armNode.rotation.y), 0, Math.cos(armNode.rotation.y));
      for (const label of labels) {
        expect(label.material).toBe(painted[i]!.material);
        expect(label.material!.backFaceCulling).toBe(true);
        expect(shadowed.has(label)).toBe(false);
        expect(label.receiveShadows).toBe(true);
        const verts = worldVertices(label);
        // 1.0 m by 0.19 m.
        const ys = verts.map(({ p }) => p.y);
        expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.19, 4);
        const centre = verts.reduce((s, { p }) => s.addInPlace(p), Vector3.Zero()).scaleInPlace(1 / verts.length);
        const normals = label.getVerticesData(VertexBuffer.NormalKind)!;
        const normal = Vector3.TransformNormal(new Vector3(normals[0], normals[1], normals[2]), label.computeWorldMatrix(true)).normalize();
        // Out of the arm's face, square to the arm, 1 mm off the 0.038 m board.
        const armAt = armNode.getAbsolutePosition();
        const offset = centre.subtract(armAt);
        expect(Vector3.Dot(normal, offset)).toBeCloseTo(0.02, 4);
        expect(Vector3.Dot(normal, along)).toBeCloseTo(0, 4);
        // Centred on the full-height board, 0.475 m out from the post end.
        expect(Vector3.Dot(offset, along)).toBeCloseTo(0.475, 4);
        // Seen from outside, looking back along -normal: u runs to the
        // viewer's right and v up, where a painted canvas's top row lands.
        const right = Vector3.Cross(Vector3.Up(), normal.scale(-1));
        const u0 = verts.filter(({ u }) => u === 0).map(({ p }) => p);
        const u1 = verts.filter(({ u }) => u === 1).map(({ p }) => p);
        expect(Vector3.Dot(u1[0]!.subtract(u0[0]!), right)).toBeCloseTo(1, 4);
        const v0 = verts.filter(({ v }) => v === 0).map(({ p }) => p.y);
        const v1 = verts.filter(({ v }) => v === 1).map(({ p }) => p.y);
        expect(Math.min(...v1) - Math.max(...v0)).toBeCloseTo(0.19, 4);
      }
    }
    signs.dispose();
    expect(scene.meshes.filter((m) => m.name.includes("_label_"))).toHaveLength(0);
  });

  it("keeps the post boxes, and letters nothing, when the models never load", async () => {
    const scene = freshScene();
    const { signs, painted, shadowed } = setup(scene, () => Promise.reject(new Error("offline")));
    await signs.ready;
    expect(scene.getMeshByName("sign_0_box")).not.toBeNull();
    expect(scene.getMeshByName("sign_1_box")).not.toBeNull();
    expect(shadowed.size).toBe(2);
    expect(painted).toHaveLength(0);
    signs.dispose();
    expect(scene.getMeshByName("sign_0_box")).toBeNull();
    expect(shadowed.size).toBe(0);
  });

  it("keeps the post boxes when only the post fails, with the arms standing off them", async () => {
    const scene = freshScene();
    const disk = diskLoader(scene);
    const { signs, painted } = setup(scene, (output) =>
      output.includes("post") ? Promise.reject(new Error("offline")) : disk(output));
    await signs.ready;
    expect(scene.getMeshByName("sign_0_box")).not.toBeNull();
    expect(scene.getTransformNodeByName("sign_0_post")).toBeNull();
    expect(scene.getTransformNodeByName("sign_0_arm_0")).not.toBeNull();
    expect(painted).toHaveLength(4);
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
    expect(scene.getTransformNodeByName("sign_0_arm_0")).toBeNull();
    expect(scene.meshes.filter((m) => m.getTotalVertices() > 0)).toHaveLength(0);
    expect(painted).toHaveLength(0);
    expect(shadowed.size).toBe(0);
  });
});
