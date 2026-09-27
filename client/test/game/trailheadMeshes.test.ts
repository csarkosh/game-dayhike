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
import { carYaw, createTrailheadMeshes, posterMaterial, type TrailheadSites } from "../../src/game/trailheadMeshes.js";

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

/** The car parked 12 m short of the trailhead along +z; the kiosk 7 m past it, its poster facing back (-z). */
const SITES: TrailheadSites = {
  car: { site: { x: 10, z: 20 }, trailhead: { x: 1, z: 32 } },
  kiosk: { site: { x: 6, z: 39 }, facing: { dx: 0, dz: -1 } },
};
const groundH = (x: number, z: number): number => 3 + 0.01 * x - 0.02 * z;
const LINES = ["MISSING", "Dana Whitcombe", "Last seen on the summit trail."];

function setup(scene: Scene, loader: (output: string) => Promise<AssetContainer>) {
  const painted: { name: string; lines: readonly string[]; width: number; height: number; material: Material }[] = [];
  const shadowed = new Set<AbstractMesh>();
  const boxMaterials: string[] = [];
  const meshes = createTrailheadMeshes(scene, SITES, groundH, {
    materialFor: (name) => {
      boxMaterials.push(name);
      return new StandardMaterial(`box_${name}`, scene);
    },
    lines: LINES,
    // A NullEngine has no canvas to paint on; the painter is the one part
    // of this that needs a browser.
    paint: (s, name, lines, width, height) => {
      const material = new PBRMaterial(name, s);
      painted.push({ name, lines, width, height, material });
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
  it("draws the sim's two boxes until the models arrive, then places each model on its site", async () => {
    const scene = freshScene();
    const gate = gatedLoader(scene);
    const { meshes, shadowed, boxMaterials } = setup(scene, gate.loader);

    const carBox = scene.getMeshByName("trailhead_car_box") as Mesh;
    const kioskBox = scene.getMeshByName("trailhead_kiosk_box") as Mesh;
    expect(boxMaterials).toEqual(["car", "kiosk"]);
    // The boxes the sim collides with: 1.8 x 1.6 x 4.6 and 2.2 x 2.5 x 1.1, standing on the ground.
    const carExtent = carBox.getBoundingInfo().boundingBox.extendSize;
    expect([carExtent.x, carExtent.y, carExtent.z].map((v) => +v.toFixed(6))).toEqual([0.9, 0.8, 2.3]);
    expect(carBox.position.x).toBe(10);
    expect(carBox.position.y).toBeCloseTo(3.5, 9);
    expect(carBox.position.z).toBe(20);
    const kioskExtent = kioskBox.getBoundingInfo().boundingBox.extendSize;
    expect([kioskExtent.x, kioskExtent.y, kioskExtent.z].map((v) => +v.toFixed(6))).toEqual([1.1, 1.25, 0.55]);
    expect(kioskBox.position.y).toBeCloseTo(3.53, 9);
    expect(shadowed.has(carBox) && shadowed.has(kioskBox)).toBe(true);

    gate.release();
    await meshes.ready;

    expect(scene.getMeshByName("trailhead_car_box")).toBeNull();
    expect(scene.getMeshByName("trailhead_kiosk_box")).toBeNull();
    expect(shadowed.has(carBox) || shadowed.has(kioskBox)).toBe(false);

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

  it("paints the poster on the kiosk's one untextured material, upright on the face toward the pad", async () => {
    const scene = freshScene();
    const { meshes, painted } = setup(scene, diskLoader(scene));
    await meshes.ready;
    expect(painted.map(({ name, lines, width, height }) => ({ name, lines, width, height }))).toEqual([
      { name: "mat_poster", lines: LINES, width: 1024, height: 512 },
    ]);
    const poster = painted[0]!.material;
    const kiosk = scene.getTransformNodeByName("trailhead_kiosk")!;
    const boards = descendantNamed(kiosk, "LOD0").getChildMeshes(false).filter((m) => m.material === poster);
    expect(boards).toHaveLength(1);
    const verts = worldVertices(boards[0]!);
    // The board hangs on the -z face here, the way the poster faces, 0.16 m off the kiosk's centre.
    for (const { p } of verts) expect(p.z).toBeCloseTo(39 - 0.159, 2);
    // Seen from the pad (looking +z, so +x is to the right), the board's
    // top-left corner carries the canvas's top-left: u = 0 and v = 1, where a
    // painted canvas's top row is uploaded.
    const top = Math.max(...verts.map(({ p }) => p.y));
    const bottom = Math.min(...verts.map(({ p }) => p.y));
    const left = Math.min(...verts.map(({ p }) => p.x));
    const right = Math.max(...verts.map(({ p }) => p.x));
    const at = (x: number, y: number) => verts.find(({ p }) => Math.abs(p.x - x) < 1e-4 && Math.abs(p.y - y) < 1e-4)!;
    expect(right - left).toBeCloseTo(2, 3);
    expect(top - bottom).toBeCloseTo(1, 3);
    expect([at(left, top).u, at(left, top).v]).toEqual([0, 1]);
    expect([at(right, top).u, at(right, top).v]).toEqual([1, 1]);
    expect([at(left, bottom).u, at(left, bottom).v]).toEqual([0, 0]);
    // The kiosk's own board material is gone; the painted one replaced it on every level.
    for (const lod of ["LOD1", "LOD2"]) {
      expect(descendantNamed(kiosk, lod).getChildMeshes(false).filter((m) => m.material === poster)).toHaveLength(1);
    }
    for (const m of kiosk.getChildMeshes(false)) {
      if (m.material === poster || m.material === null) continue;
      expect((m.material as PBRMaterial).albedoTexture).not.toBeNull();
    }
    meshes.dispose();
  });

  it("finds the poster by its missing base colour texture, whose v the loader leaves top-down", async () => {
    const scene = freshScene();
    const container = await diskLoader(scene)("models/trailhead.kiosk.glb");
    const board = posterMaterial(container)!;
    expect(board).toBeInstanceOf(PBRMaterial);
    const mesh = container.meshes.find((m) => m.material === board)!;
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const uv = mesh.getVerticesData(VertexBuffer.UVKind)!;
    // The file's own top-left corner (x = -1 in the file, y = 1.866): the
    // loader keeps glTF's v = 0 at the top, which is why the poster's v is
    // turned before a painted canvas goes on it.
    let found = false;
    for (let i = 0; i < pos.length / 3; i++) {
      if (Math.abs((pos[3 * i] as number) + 1) < 1e-3 && Math.abs((pos[3 * i + 1] as number) - 1.866) < 1e-3) {
        expect([uv[2 * i], uv[2 * i + 1]]).toEqual([0, 0]);
        found = true;
      }
    }
    expect(found).toBe(true);
    container.dispose();
  });

  it("keeps the boxes, and paints nothing, when the models never load", async () => {
    const scene = freshScene();
    const { meshes, painted, shadowed } = setup(scene, () => Promise.reject(new Error("offline")));
    await meshes.ready;
    expect(scene.getMeshByName("trailhead_car_box")).not.toBeNull();
    expect(scene.getMeshByName("trailhead_kiosk_box")).not.toBeNull();
    expect(shadowed.size).toBe(2);
    expect(painted).toHaveLength(0);
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
