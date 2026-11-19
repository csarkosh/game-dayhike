import { describe, expect, it } from "vitest";
import { CAP_BRIM, CAP_CROWN, CAP_LIFT, capGeometry, capSeat, capSeatMatrix, cappedCylinder, slicedSphere } from "../../src/game/droppedCap.js";
import { babylonValues } from "../helpers/babylonFixture.js";

type Built = { positions: number[]; normals: number[]; indices: number[] };
/**
 * What Babylon.js gave, recorded: the half sphere and the cylinder its builders make with the cap's own numbers
 * (their positions and normals as the single-precision floats a mesh holds), and the two meshes built
 * with them for a cap, each vertex carried through its mesh's own world
 * matrix, with the mesh's indices.
 */
const BABYLON = babylonValues<{
  crown: Built & { diameter: number; segments: number; slice: number };
  brim: Built & { diameter: number; height: number; tessellation: number };
  built: { cap: { x: number; z: number; yaw: number }; groundY: number; meshes: { name: string; world: number[]; indices: number[] }[] };
}>("numbers/droppedCap.json");

describe("the dropped cap's shape with no engine", () => {
  it("builds the crown's half sphere as Babylon.js does, vertex for vertex", () => {
    // `CreateSphereVertexData({ diameter, segments, slice })` with the crown's own numbers.
    const theirs = BABYLON.crown;
    expect([theirs.diameter, theirs.segments, theirs.slice]).toEqual([CAP_CROWN.diameter, CAP_CROWN.segments, CAP_CROWN.slice]);
    const ours = slicedSphere(CAP_CROWN.diameter, CAP_CROWN.segments, CAP_CROWN.slice);
    expect(theirs.positions.length).toBeGreaterThan(100);
    expect([...ours.positions]).toEqual(theirs.positions);
    expect([...ours.normals]).toEqual(theirs.normals);
    expect([...ours.indices]).toEqual(theirs.indices);
  });

  it("builds the brim's cylinder as Babylon.js does, vertex for vertex", () => {
    // `CreateCylinderVertexData({ diameter, height, tessellation })` with the brim's own numbers.
    const theirs = BABYLON.brim;
    expect([theirs.diameter, theirs.height, theirs.tessellation]).toEqual([CAP_BRIM.diameter, CAP_BRIM.height, CAP_BRIM.tessellation]);
    const ours = cappedCylinder(CAP_BRIM.diameter, CAP_BRIM.height, CAP_BRIM.tessellation);
    expect(theirs.positions.length).toBeGreaterThan(100);
    expect([...ours.positions]).toEqual(theirs.positions);
    expect([...ours.normals]).toEqual(theirs.normals);
    expect([...ours.indices]).toEqual(theirs.indices);
  });

  it("is the two meshes recorded of the cap on Babylon.js, each vertex where its mesh's own transform puts it", () => {
    const cap = { x: 3, z: -4, yaw: 1 };
    expect([BABYLON.built.cap, BABYLON.built.groundY]).toEqual([cap, 12]);
    const seat = capSeatMatrix(cap, 12);
    const ours = capGeometry();
    // The crown's mesh, then the brim's, each vertex where its mesh's world matrix carried it.
    const meshes = BABYLON.built.meshes;
    expect(meshes.map((mesh) => mesh.name)).toEqual(["dropped_cap_crown", "dropped_cap_brim"]);
    let v = 0;
    let k = 0;
    for (const mesh of meshes) {
      const positions = mesh.world;
      const first = v / 3;
      for (let i = 0; i < positions.length; i += 3) {
        const theirs = { x: positions[i] as number, y: positions[i + 1] as number, z: positions[i + 2] as number };
        const x = ours.positions[v] as number, y = ours.positions[v + 1] as number, z = ours.positions[v + 2] as number;
        expect(x * seat[0]! + y * seat[4]! + z * seat[8]! + seat[12]!).toBeCloseTo(theirs.x, 4);
        expect(x * seat[1]! + y * seat[5]! + z * seat[9]! + seat[13]!).toBeCloseTo(theirs.y, 4);
        expect(x * seat[2]! + y * seat[6]! + z * seat[10]! + seat[14]!).toBeCloseTo(theirs.z, 4);
        v += 3;
      }
      for (const index of mesh.indices) expect(ours.indices[k++]).toBe(index + first);
    }
    expect(v).toBe(ours.positions.length);
    expect(k).toBe(ours.indices.length);
    for (let i = 0; i < ours.normals.length; i += 3) expect(Math.hypot(ours.normals[i]!, ours.normals[i + 1]!, ours.normals[i + 2]!)).toBeCloseTo(1, 5);
  });

  it("seats the cap a little over the ground, tipped, turned by its yaw", () => {
    const seat = capSeat({ x: 3, z: -4, yaw: 1 }, 12);
    expect(seat.position).toEqual({ x: 3, y: 12 + CAP_LIFT, z: -4 });
    expect(seat.rotation).toEqual({ x: 0.18, y: 1, z: 0.12 });
  });
});
