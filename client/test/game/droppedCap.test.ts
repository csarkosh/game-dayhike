import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { CreateCylinderVertexData } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { CreateSphereVertexData } from "@babylonjs/core/Meshes/Builders/sphereBuilder.js";
import { CAP_BRIM, CAP_CROWN, CAP_LIFT, capGeometry, capSeat, capSeatMatrix, cappedCylinder, slicedSphere } from "../../src/game/droppedCap.js";
import { createDroppedCap } from "../../src/game/droppedItem.js";

describe("the dropped cap's shape with no engine", () => {
  it("builds the crown's half sphere as Babylon.js does, vertex for vertex", () => {
    const theirs = CreateSphereVertexData({ diameter: CAP_CROWN.diameter, segments: CAP_CROWN.segments, slice: CAP_CROWN.slice });
    const ours = slicedSphere(CAP_CROWN.diameter, CAP_CROWN.segments, CAP_CROWN.slice);
    expect([...ours.positions]).toEqual([...new Float32Array(theirs.positions as number[])]);
    expect([...ours.normals]).toEqual([...new Float32Array(theirs.normals as number[])]);
    expect([...ours.indices]).toEqual([...(theirs.indices as number[])]);
  });

  it("builds the brim's cylinder as Babylon.js does, vertex for vertex", () => {
    const theirs = CreateCylinderVertexData({ diameter: CAP_BRIM.diameter, height: CAP_BRIM.height, tessellation: CAP_BRIM.tessellation });
    const ours = cappedCylinder(CAP_BRIM.diameter, CAP_BRIM.height, CAP_BRIM.tessellation);
    expect([...ours.positions]).toEqual([...new Float32Array(theirs.positions as number[])]);
    expect([...ours.normals]).toEqual([...new Float32Array(theirs.normals as number[])]);
    expect([...ours.indices]).toEqual([...(theirs.indices as number[])]);
  });

  it("is the two meshes the game builds on Babylon.js, each vertex where its mesh's own transform puts it", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cap = { x: 3, z: -4, yaw: 1 };
    const view = createDroppedCap(scene, cap, 12);
    const seat = capSeatMatrix(cap, 12);
    const ours = capGeometry();
    const meshes = ["dropped_cap_crown", "dropped_cap_brim"].map((name) => view.node.getChildMeshes(false).find((m) => m.name === name) as Mesh);
    let v = 0;
    let k = 0;
    for (const mesh of meshes) {
      const world = mesh.computeWorldMatrix(true);
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
      const first = v / 3;
      for (let i = 0; i < positions.length; i += 3) {
        const theirs = Vector3.TransformCoordinates(new Vector3(positions[i], positions[i + 1], positions[i + 2]), world);
        const x = ours.positions[v] as number, y = ours.positions[v + 1] as number, z = ours.positions[v + 2] as number;
        expect(x * seat[0]! + y * seat[4]! + z * seat[8]! + seat[12]!).toBeCloseTo(theirs.x, 4);
        expect(x * seat[1]! + y * seat[5]! + z * seat[9]! + seat[13]!).toBeCloseTo(theirs.y, 4);
        expect(x * seat[2]! + y * seat[6]! + z * seat[10]! + seat[14]!).toBeCloseTo(theirs.z, 4);
        v += 3;
      }
      for (const index of mesh.getIndices() as ArrayLike<number> as number[]) expect(ours.indices[k++]).toBe(index + first);
    }
    expect(v).toBe(ours.positions.length);
    expect(k).toBe(ours.indices.length);
    for (let i = 0; i < ours.normals.length; i += 3) expect(Math.hypot(ours.normals[i]!, ours.normals[i + 1]!, ours.normals[i + 2]!)).toBeCloseTo(1, 5);
    scene.dispose();
    engine.dispose();
  });

  it("seats the cap a little over the ground, tipped, turned by its yaw", () => {
    const seat = capSeat({ x: 3, z: -4, yaw: 1 }, 12);
    expect(seat.position).toEqual({ x: 3, y: 12 + CAP_LIFT, z: -4 });
    expect(seat.rotation).toEqual({ x: 0.18, y: 1, z: 0.12 });
  });
});
