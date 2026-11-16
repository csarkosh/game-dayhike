import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { loadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic.js";
import { BOARD_FACE, boardText } from "../../src/game/boardFace.js";
import type { BoardDrawing } from "../../src/game/boardDraw.js";
import { glbParts } from "../../src/game/glbParts.js";
import { CAB_SKY as STAGE_CAB_SKY } from "../../src/game/scene/sceneStage.js";
import {
  BOARD_FACE_LIFT, BODY_OUTPUT, BODY_STAND_IN, CAB_PARTS, CAB_SKY, FILM_CAR_OUTPUT, TRAILHEAD_CAR_OUTPUT, TRAILHEAD_KIOSK_OUTPUT, boardFaceCorners, boardYaw,
  carYaw, type TrailheadSites,
} from "../../src/game/sceneryParts.js";
import { createTrailheadMeshes } from "../../src/game/trailheadMeshes.js";

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
const bytesOf = (output: string): Buffer => readFileSync(new URL(`../../assets/${output}`, import.meta.url));
function diskLoader(scene: Scene) {
  return (output: string): Promise<AssetContainer> => loadAssetContainerAsync(new Uint8Array(bytesOf(output)), scene, { pluginExtension: ".glb" });
}

const groundH = (x: number, z: number): number => 3 + 0.01 * x - 0.02 * z;
const DRAWING: BoardDrawing = {
  seed: 2032433950,
  text: boardText("Trail 14", "Hugh Kowalski", "Last seen at Trail 14.", 1274),
  map: { nodes: [{ x: 0, z: 0 }, { x: 100, z: 0 }], edges: [{ a: 0, b: 1, kind: "stem" }], road: [], features: [], places: [], summitName: "Summit" },
  urls: { paper: null, portrait: null },
};

describe("the scenery placed once, as files and numbers", () => {
  it("names a file the game ships for each model", () => {
    for (const output of [TRAILHEAD_CAR_OUTPUT, TRAILHEAD_KIOSK_OUTPUT, FILM_CAR_OUTPUT, BODY_OUTPUT]) {
      expect(bytesOf(output).byteLength).toBeGreaterThan(1000);
    }
  });

  it("turns the car's nose along the road, square to its box, by the sim's own rule", () => {
    expect(carYaw({ x: 0, z: 0 }, { x: 5, z: 12 })).toBe(0);
    expect(carYaw({ x: 0, z: 0 }, { x: 5, z: -12 })).toBe(Math.PI);
  });

  it("turns the board's model, whose face looks along +z, onto the way the board faces", () => {
    expect(boardYaw({ x: 0, z: 0, fx: 0, fz: 1, ax: 1, az: 0 })).toBe(0);
    expect(boardYaw({ x: 0, z: 0, fx: 1, fz: 0, ax: 0, az: -1 })).toBeCloseTo(Math.PI / 2, 12);
    expect(boardYaw({ x: 0, z: 0, fx: 0, fz: -1, ax: -1, az: 0 })).toBeCloseTo(Math.PI, 12);
  });

  it("stands the painted face where the shell on Babylon.js stands its plane, corner for corner", async () => {
    for (const board of [
      { x: 6, z: 39, fx: 0, fz: -1, ax: 1, az: 0 },
      { x: -265.2, z: -6.6, fx: -0.8630244082664948, fz: 0.5051622221982427, ax: -0.5051622221982427, az: -0.8630244082664948 },
    ]) {
      const scene = freshScene();
      const sites: TrailheadSites = { board };
      const meshes = createTrailheadMeshes(scene, sites, groundH, {
        materialFor: (name) => new StandardMaterial(`box_${name}`, scene),
        board: DRAWING,
        paint: (s, name) => new PBRMaterial(name, s),
        loader: diskLoader(scene),
      });
      await meshes.ready;
      const plane = scene.getMeshByName("trailhead_board_face") as AbstractMesh;
      const world = plane.computeWorldMatrix(true);
      const positions = plane.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
      const uvs = plane.getVerticesData(VertexBuffer.UVKind) as Float32Array;
      const ours = boardFaceCorners(board, groundH(board.x, board.z));
      for (const [c, [u, v]] of ([[0, 0], [1, 0], [1, 1], [0, 1]] as const).entries()) {
        let at = -1;
        for (let i = 0; i < 4; i++) if (uvs[i * 2] === u && uvs[i * 2 + 1] === v) at = i;
        const corner = Vector3.TransformCoordinates(new Vector3(positions[at * 3], positions[at * 3 + 1], positions[at * 3 + 2]), world);
        expect(ours.corners[c * 3]).toBeCloseTo(corner.x, 4);
        expect(ours.corners[c * 3 + 1]).toBeCloseTo(corner.y, 4);
        expect(ours.corners[c * 3 + 2]).toBeCloseTo(corner.z, 4);
      }
      const out = Vector3.TransformNormal(new Vector3(0, 0, -1), world).normalize();
      expect(ours.normal.x).toBeCloseTo(out.x, 5);
      expect(ours.normal.z).toBeCloseTo(out.z, 5);
      // The face looks the way the board faces, the lift in front of the model's planks.
      expect(ours.normal.x).toBeCloseTo(board.fx, 6);
      expect(ours.normal.z).toBeCloseTo(board.fz, 6);
      const centre = { x: 0, z: 0 };
      for (let c = 0; c < 4; c++) {
        centre.x += (ours.corners[c * 3] as number) / 4;
        centre.z += (ours.corners[c * 3 + 2] as number) / 4;
      }
      expect((centre.x - board.x) * board.fx + (centre.z - board.z) * board.fz).toBeCloseTo(BOARD_FACE.front + BOARD_FACE_LIFT, 5);
      meshes.dispose();
      engine?.dispose();
      engine = null;
    }
  });

  it("dims the cab's plain parts by the stage's own number, and finds them in the film's car", () => {
    expect(CAB_SKY).toBe(STAGE_CAB_SKY);
    const file = bytesOf(FILM_CAR_OUTPUT);
    const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    const dimmed = new Set(CAB_PARTS.flatMap((node) => glbParts(bytes, node).map((part) => part.material)));
    // The radio's cradle and the handset under it: two materials of their own, which no other part of the car wears.
    expect([...dimmed].sort()).toEqual(["intro.car.material5", "intro.car.material6"]);
    const worn = glbParts(bytes, "LOD0").map((part) => part.material);
    expect(worn.filter((name) => name !== null && dimmed.has(name))).toHaveLength(glbParts(bytes, "cradle").length);
  });

  it("stands the body's stand-in on the ground: a cross taller than the figure it holds", () => {
    const { upright, crossbar, capsule } = BODY_STAND_IN;
    expect(upright.up - upright.height / 2).toBe(0);
    expect(crossbar.up + crossbar.height / 2).toBeLessThan(upright.height);
    expect(capsule.up + capsule.height / 2).toBeLessThan(upright.height);
    expect(capsule.forward).toBeGreaterThan(upright.depth / 2);
  });
});
