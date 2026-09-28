import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Node } from "@babylonjs/core/node.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { carYaw, createTrailheadMeshes, type TrailheadSites } from "../../src/game/trailheadMeshes.js";
import type { BoardDrawing } from "../../src/game/boardPaint.js";
import { boardText } from "../../src/game/boardFace.js";

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

/** The car parked 12 m short of the trailhead along +z; the board 7 m past it, its face looking back (-z). */
const SITES: TrailheadSites = {
  car: { site: { x: 10, z: 20 }, trailhead: { x: 1, z: 32 } },
  board: { x: 6, z: 39, fx: 0, fz: -1, ax: 1, az: 0 },
};
const groundH = (x: number, z: number): number => 3 + 0.01 * x - 0.02 * z;
const DRAWING: BoardDrawing = {
  seed: 2032433950,
  text: boardText("Trail 14", "Hugh Kowalski", "Last seen at Trail 14.", 1274),
  map: { nodes: [{ x: 0, z: 0 }, { x: 100, z: 0 }], edges: [{ a: 0, b: 1, kind: "stem" }], road: [], features: [], places: [], summitName: "Summit" },
  urls: { paper: null, portrait: null },
};

function setup(scene: Scene, loader: (output: string) => Promise<AssetContainer>, fails = false) {
  const painted: { name: string; drawing: BoardDrawing; material: Material }[] = [];
  const shadowed = new Set<AbstractMesh>();
  const boxMaterials: string[] = [];
  const meshes = createTrailheadMeshes(scene, SITES, groundH, {
    materialFor: (name) => {
      boxMaterials.push(name);
      return new StandardMaterial(`box_${name}`, scene);
    },
    board: DRAWING,
    // A NullEngine has no canvas to paint on; the painter is the one part
    // of this that needs a browser.
    paint: (s, name, drawing) => {
      if (fails) throw new Error("no canvas");
      const material = new PBRMaterial(name, s);
      painted.push({ name, drawing, material });
      return material;
    },
    shadows: { add: (m) => shadowed.add(m), remove: (m) => shadowed.delete(m) },
    loader,
  });
  return { meshes, painted, shadowed, boxMaterials };
}

function descendantNamed(root: Node, name: string): Node {
  const found = root.getDescendants(false).find((n) => n.name === name);
  if (found === undefined) throw new Error(`no ${name} under ${root.name}`);
  return found;
}

/** Every vertex of a mesh in world space, with its UV. */
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

describe("carYaw", () => {
  it("turns the car's nose toward the trailhead along the road, square to its box", () => {
    expect(carYaw({ x: 0, z: 0 }, { x: 5, z: 12 })).toBe(0);
    expect(carYaw({ x: 0, z: 12 }, { x: 5, z: 0 })).toBeCloseTo(3.141592653589793, 12);
  });
});

describe("createTrailheadMeshes", () => {
  it("draws the sim's boxes until the models arrive, then places each model on its site", async () => {
    const scene = freshScene();
    const gate = gatedLoader(scene);
    const { meshes, shadowed, boxMaterials } = setup(scene, gate.loader);

    const carBox = scene.getMeshByName("trailhead_car_box") as Mesh;
    const boardBoxes = [0, 1, 2, 3, 4].map((k) => scene.getMeshByName(`trailhead_kiosk_box_${k}`) as Mesh);
    expect(boxMaterials).toEqual(["car", "kiosk", "kiosk", "kiosk", "kiosk", "kiosk"]);
    // The boxes the sim collides with: 1.8 x 1.6 x 4.6 and 2.2 x 2.5 x 1.1, standing on the ground.
    const carExtent = carBox.getBoundingInfo().boundingBox.extendSize;
    expect([carExtent.x, carExtent.y, carExtent.z].map((v) => +v.toFixed(6))).toEqual([0.9, 0.8, 2.3]);
    expect(carBox.position.x).toBe(10);
    expect(carBox.position.y).toBeCloseTo(3.5, 9);
    expect(carBox.position.z).toBe(20);
    // The board's five: 0.55 x 2.5 x 0.55 each, 0.44 m apart along the board's own line (+x here).
    expect(boardBoxes.map((b) => +b.position.x.toFixed(6))).toEqual([5.12, 5.56, 6, 6.44, 6.88]);
    for (const b of boardBoxes) {
      const e = b.getBoundingInfo().boundingBox.extendSize;
      expect([e.x, e.y, e.z].map((v) => +v.toFixed(6))).toEqual([0.275, 1.25, 0.275]);
      expect(b.position.z).toBe(39);
    }
    // Each stands on the ground at its own centre: 3 + 0.01 x - 0.02 z, and half its height.
    expect(boardBoxes[0]!.position.y).toBeCloseTo(3.5212, 9);
    expect(boardBoxes[4]!.position.y).toBeCloseTo(3.5388, 9);
    expect(shadowed.has(carBox) && boardBoxes.every((b) => shadowed.has(b))).toBe(true);

    gate.release();
    await meshes.ready;

    expect(scene.getMeshByName("trailhead_car_box")).toBeNull();
    for (const k of [0, 1, 2, 3, 4]) expect(scene.getMeshByName(`trailhead_kiosk_box_${k}`)).toBeNull();
    expect(shadowed.has(carBox) || boardBoxes.some((b) => shadowed.has(b))).toBe(false);

    const car = scene.getTransformNodeByName("trailhead_car")!;
    expect(car.position.x).toBe(10);
    expect(car.position.y).toBeCloseTo(2.7, 9);
    expect(car.position.z).toBe(20);
    expect(car.rotation.y).toBe(0);
    const kiosk = scene.getTransformNodeByName("trailhead_kiosk")!;
    expect(kiosk.position.x).toBe(6);
    expect(kiosk.position.y).toBeCloseTo(2.28, 9);
    expect(kiosk.position.z).toBe(39);
    expect(kiosk.rotation.y).toBeCloseTo(3.141592653589793, 12);

    for (const root of [car, kiosk]) {
      expect(descendantNamed(root, "LOD0").isEnabled(false)).toBe(true);
      expect(descendantNamed(root, "LOD1").isEnabled(false)).toBe(false);
      expect(descendantNamed(root, "LOD2").isEnabled(false)).toBe(false);
      // Every LOD0 mesh casts; none of the coarser levels does.
      const lod0 = (descendantNamed(root, "LOD0") as Node).getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
      expect(lod0.length).toBeGreaterThan(0);
      for (const m of lod0) expect(shadowed.has(m)).toBe(true);
      for (const lod of ["LOD1", "LOD2"]) {
        for (const m of descendantNamed(root, lod).getChildMeshes(false)) expect(shadowed.has(m)).toBe(false);
      }
    }
    meshes.dispose();
    expect(shadowed.size).toBe(0);
    expect(scene.getTransformNodeByName("trailhead_car")).toBeNull();
    expect(scene.meshes.filter((m) => m.getTotalVertices() > 0)).toHaveLength(0);
  });

  it("parks the car nose-first toward the trailhead: its low bonnet is the end nearer the pad", async () => {
    const scene = freshScene();
    const { meshes } = setup(scene, diskLoader(scene));
    await meshes.ready;
    const car = scene.getTransformNodeByName("trailhead_car")!;
    const ground = groundH(10, 20);
    let front = 0, rear = 0;
    for (const m of descendantNamed(car, "LOD0").getChildMeshes(false)) {
      if (m.getTotalVertices() === 0) continue;
      for (const { p } of worldVertices(m)) {
        // The last 0.8 m at each end of a 4.36 m body centred on z = 20.
        if (p.z > 21.4) front = Math.max(front, p.y - ground);
        if (p.z < 18.6) rear = Math.max(rear, p.y - ground);
      }
    }
    // A bonnet at about a metre toward the trailhead (+z here); the roof
    // carried to the tailgate at about one and a half the other way.
    expect(front).toBeLessThan(1.2);
    expect(rear).toBeGreaterThan(1.4);
    meshes.dispose();
  });

  it("draws the face on a plane of its own, a millimetre in front of the model's, upright and toward the player", async () => {
    const scene = freshScene();
    const { meshes, painted } = setup(scene, diskLoader(scene));
    await meshes.ready;
    expect(painted.map(({ name, drawing }) => ({ name, drawing }))).toEqual([{ name: "trailhead_board_face", drawing: DRAWING }]);
    const face = scene.getMeshByName("trailhead_board_face") as Mesh;
    expect(face.material).toBe(painted[0]!.material);
    const verts = worldVertices(face);
    expect(verts).toHaveLength(4);
    // The board is at (6, 39) and its face looks toward -z: the plane stands
    // 0.159 m and a millimetre in front of the board's centre plane.
    for (const { p } of verts) expect(p.z).toBeCloseTo(38.84, 6);
    const top = Math.max(...verts.map(({ p }) => p.y));
    const bottom = Math.min(...verts.map(({ p }) => p.y));
    const left = Math.min(...verts.map(({ p }) => p.x));
    const right = Math.max(...verts.map(({ p }) => p.x));
    // 2 m by 1 m, its centre 1.37 m above the board's foot, which is on the ground at 2.28.
    expect(right - left).toBeCloseTo(2, 6);
    expect(top - bottom).toBeCloseTo(1, 6);
    expect((top + bottom) / 2).toBeCloseTo(3.65, 6);
    expect((left + right) / 2).toBeCloseTo(6, 6);
    // Seen from in front (looking +z, so +x is to the right), the texture's
    // top-left corner is the plane's: u = 0 and v = 1, where a painted
    // canvas's top row is uploaded.
    const at = (x: number, y: number) => verts.find(({ p }) => Math.abs(p.x - x) < 1e-4 && Math.abs(p.y - y) < 1e-4)!;
    expect([at(left, top).u, at(left, top).v]).toEqual([0, 1]);
    expect([at(right, top).u, at(right, top).v]).toEqual([1, 1]);
    expect([at(left, bottom).u, at(left, bottom).v]).toEqual([0, 0]);
    expect(face.isPickable).toBe(false);
    meshes.dispose();
    expect(scene.getMeshByName("trailhead_board_face")).toBeNull();
  });

  it("stands the plane on the model's own face: a millimetre in front of it, and its size", async () => {
    const scene = freshScene();
    const { meshes } = setup(scene, diskLoader(scene));
    await meshes.ready;
    const kiosk = scene.getTransformNodeByName("trailhead_kiosk")!;
    const plane = worldVertices(scene.getMeshByName("trailhead_board_face") as Mesh);
    // The model's panel: what it draws between its posts, from 0.8 m to
    // 1.9 m above its foot, which is on the ground at 2.28.
    const panel = kiosk.getChildMeshes(false)
      .filter((m) => m.name !== "trailhead_board_face" && m.getTotalVertices() > 0)
      .flatMap((m) => worldVertices(m))
      .filter(({ p }) => Math.abs(p.x - 6) <= 1.001 && p.y >= 3.08 && p.y <= 4.18);
    expect(panel.length).toBeGreaterThan(0);
    // The board's face looks toward -z, so its front is the least z drawn.
    const front = Math.min(...panel.map(({ p }) => p.z));
    expect(front - plane[0]!.p.z).toBeCloseTo(0.001, 3);
    const face = panel.filter(({ p }) => p.z - front < 0.0005);
    const xs = face.map(({ p }) => p.x), ys = face.map(({ p }) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1, 2);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(6, 2);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(3.65, 2);
    meshes.dispose();
  });

  it("stands the board without a face when the face cannot be painted", async () => {
    const scene = freshScene();
    const { meshes } = setup(scene, diskLoader(scene), true);
    await expect(meshes.ready).resolves.toBeUndefined();
    expect(scene.getTransformNodeByName("trailhead_kiosk")).not.toBeNull();
    expect(scene.getTransformNodeByName("trailhead_car")).not.toBeNull();
    expect(scene.getMeshByName("trailhead_kiosk_box_0")).toBeNull();
    expect(scene.getMeshByName("trailhead_board_face")).toBeNull();
    meshes.dispose();
  });

  it("leaves the model's own materials as they are", async () => {
    const scene = freshScene();
    const { meshes, painted } = setup(scene, diskLoader(scene));
    await meshes.ready;
    const kiosk = scene.getTransformNodeByName("trailhead_kiosk")!;
    // The file's own root is a mesh with nothing to draw, and no material.
    const drawn = kiosk.getChildMeshes(false).filter((m) => m.name !== "trailhead_board_face" && m.getTotalVertices() > 0);
    expect(drawn.length).toBeGreaterThan(0);
    for (const m of drawn) {
      expect(m.material).not.toBe(painted[0]!.material);
      expect(m.material).not.toBeNull();
    }
    meshes.dispose();
  });

  it("keeps the boxes, and paints nothing, when the models never load", async () => {
    const scene = freshScene();
    const { meshes, painted, shadowed } = setup(scene, () => Promise.reject(new Error("offline")));
    await meshes.ready;
    expect(scene.getMeshByName("trailhead_car_box")).not.toBeNull();
    expect(scene.getMeshByName("trailhead_kiosk_box_0")).not.toBeNull();
    expect(scene.getMeshByName("trailhead_kiosk_box_4")).not.toBeNull();
    expect(shadowed.size).toBe(6);
    expect(painted).toHaveLength(0);
    expect(scene.getMeshByName("trailhead_board_face")).toBeNull();
    meshes.dispose();
    expect(scene.getMeshByName("trailhead_car_box")).toBeNull();
    expect(shadowed.size).toBe(0);
  });

  it("drops the models if disposed while they load", async () => {
    const scene = freshScene();
    const gate = gatedLoader(scene);
    const { meshes, painted, shadowed } = setup(scene, gate.loader);
    meshes.dispose();
    expect(scene.getMeshByName("trailhead_car_box")).toBeNull();
    gate.release();
    await meshes.ready;
    expect(scene.getTransformNodeByName("trailhead_car")).toBeNull();
    expect(scene.getTransformNodeByName("trailhead_kiosk")).toBeNull();
    expect(scene.meshes.filter((m) => m.getTotalVertices() > 0)).toHaveLength(0);
    expect(painted).toHaveLength(0);
    expect(shadowed.size).toBe(0);
  });
});
