import { describe, expect, it } from "vitest";
import type { ChunkGrid } from "../../src/sim/chunkGrid.js";
import { CHUNK_SIZE } from "@csarkosh/engine/sim/forestConstants";
import {
  PROP_COLOURS, PROP_DRAWN_ELSEWHERE, PROP_MESH_RADIUS_CHUNKS, PROP_ROUGHNESS, brushBoxes, chunkPropBoxes, propBoxGeometry, propBoxesGeometry, propChunk,
  propChunkKey, propColour, propWindow,
} from "../../src/game/propBoxes.js";
import { parseLevel } from "../../src/sim/level.js";
import sandbox01 from "../../levels/sandbox01.json" with { type: "json" };
import { babylonValues } from "../helpers/babylonFixture.js";

/** A grid of one chunk's props, wherever it is asked. */
const gridOf = (props: { material: string; box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } }[]): ChunkGrid =>
  ({ chunkAt: () => ({ props }) }) as unknown as ChunkGrid;

describe("the chunk props as boxes", () => {
  it("draws the chunks in a square round the chunk a place is in", () => {
    expect(propChunk(0, 0)).toEqual([0, 0]);
    expect(propChunk(-0.5, CHUNK_SIZE + 1)).toEqual([-1, 1]);
    const window = propWindow(4, -2);
    const side = 2 * PROP_MESH_RADIUS_CHUNKS + 1;
    expect(window).toHaveLength(side * side);
    expect(window[0]).toEqual([4 - PROP_MESH_RADIUS_CHUNKS, -2 - PROP_MESH_RADIUS_CHUNKS]);
    expect(window[1]).toEqual([4 - PROP_MESH_RADIUS_CHUNKS, -2 - PROP_MESH_RADIUS_CHUNKS + 1]);
    expect(window[window.length - 1]).toEqual([4 + PROP_MESH_RADIUS_CHUNKS, -2 + PROP_MESH_RADIUS_CHUNKS]);
    expect(new Set(window.map(([cx, cz]) => propChunkKey(cx, cz))).size).toBe(side * side);
    expect(propChunkKey(3, -7)).toBe("3,-7");
  });

  it("makes a box of every prop no other shell draws, named by its chunk, its place in the chunk and its material", () => {
    const grid = gridOf([
      { material: "trunk", box: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 9, z: 1 } } },
      { material: "crate", box: { min: { x: 10, y: 0, z: 10 }, max: { x: 12, y: 1, z: 13 } } },
      { material: "rock", box: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } },
      { material: "pillar", box: { min: { x: -4, y: 2, z: 6 }, max: { x: -3, y: 6, z: 7 } } },
    ]);
    expect(chunkPropBoxes(grid, 2, -1)).toEqual([
      { name: "prop_2_-1_1_crate", material: "crate", x: 11, y: 0.5, z: 11.5, width: 2, height: 1, depth: 3 },
      { name: "prop_2_-1_3_pillar", material: "pillar", x: -3.5, y: 4, z: 6.5, width: 1, height: 4, depth: 1 },
    ]);
    for (const material of ["trunk", "rock", "cliff", "car", "kiosk", "signpost"]) expect(PROP_DRAWN_ELSEWHERE.has(material), material).toBe(true);
    expect(chunkPropBoxes(gridOf([]), 0, 0)).toEqual([]);
  });

  it("colours a prop by its material's name, a name with no colour as the default, and is matt", () => {
    expect(propColour("crate")).toEqual([0.55, 0.42, 0.26]);
    expect(propColour("pillar")).toBe(PROP_COLOURS.pillar);
    expect(propColour("nothing of the kind")).toEqual([0.5, 0.5, 0.5]);
    expect(PROP_ROUGHNESS).toBe(0.9);
  });

  it("lays a box's mesh where the prop stands: its eight corners, a normal a face, each face wound as Babylon winds a box", () => {
    const box = { name: "prop", material: "crate", x: 11, y: 0.5, z: 11.5, width: 2, height: 1, depth: 3 };
    const { positions, normals, indices } = propBoxGeometry(box);
    expect(positions).toHaveLength(72);
    expect(indices).toHaveLength(36);
    const corners = new Set<string>();
    for (let i = 0; i < 72; i += 3) corners.add(`${positions[i]},${positions[i + 1]},${positions[i + 2]}`);
    expect(corners.size).toBe(8);
    for (const corner of corners) {
      const [x, y, z] = corner.split(",").map(Number) as [number, number, number];
      expect([Math.abs(x - 11), Math.abs(y - 0.5), Math.abs(z - 11.5)]).toEqual([1, 0.5, 1.5]);
    }
    /** For each triangle, the turn from its first edge to its second, along the first vertex's normal. */
    const turns = (p: ArrayLike<number>, n: ArrayLike<number>, tri: ArrayLike<number>): number[] => {
      const out: number[] = [];
      for (let t = 0; t < tri.length; t += 3) {
        const [a, b, c] = [tri[t] as number, tri[t + 1] as number, tri[t + 2] as number];
        const e1 = [0, 1, 2].map((k) => (p[b * 3 + k] as number) - (p[a * 3 + k] as number)) as [number, number, number];
        const e2 = [0, 1, 2].map((k) => (p[c * 3 + k] as number) - (p[a * 3 + k] as number)) as [number, number, number];
        const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        out.push(Math.sign(cross[0]! * (n[a * 3] as number) + cross[1]! * (n[a * 3 + 1] as number) + cross[2]! * (n[a * 3 + 2] as number)));
      }
      return out;
    };
    const mine = turns(positions, normals, indices);
    expect(new Set(mine).size).toBe(1);
    // Every face's normal points out of the box.
    for (let i = 0; i < 72; i += 3) {
      const out = ((positions[i] as number) - 11) * (normals[i] as number) + ((positions[i + 1] as number) - 0.5) * (normals[i + 1] as number) + ((positions[i + 2] as number) - 11.5) * (normals[i + 2] as number);
      expect(out).toBeGreaterThan(0);
    }
    // The box Babylon.js builds of that width, height and depth (`MeshBuilder.CreateBox`), recorded.
    const built = babylonValues<{ positions: number[]; normals: number[]; indices: number[] }>("numbers/box.json");
    expect([built.positions.length, built.normals.length, built.indices.length]).toEqual([72, 72, 36]);
    const theirs = turns(built.positions, built.normals, built.indices);
    expect(theirs).toHaveLength(12);
    expect(new Set(theirs)).toEqual(new Set(mine));
  });
});

describe("a hand-authored level's brushes as boxes", () => {
  it("makes a box of every brush, in the level's order: its box's size, at its middle, in its material's colour", () => {
    const level = parseLevel(sandbox01);
    const boxes = brushBoxes(level.brushes);
    expect(boxes).toHaveLength(13);
    expect(boxes.map((box) => box.name)).toEqual(level.brushes.map((_, i) => `brush_${i}`));
    // The floor: 64 m square, a metre thick, its top at the ground.
    expect(boxes[0]).toEqual({ name: "brush_0", material: "concrete", x: 0, y: -0.5, z: 0, width: 64, height: 1, depth: 64 });
    for (const [i, box] of boxes.entries()) {
      const brush = level.brushes[i]!;
      expect([box.x - box.width / 2, box.y - box.height / 2, box.z - box.depth / 2]).toEqual([brush.box.min.x, brush.box.min.y, brush.box.min.z]);
      expect([box.x + box.width / 2, box.y + box.height / 2, box.z + box.depth / 2]).toEqual([brush.box.max.x, brush.box.max.y, brush.box.max.z]);
      expect(propColour(box.material)).toBe(PROP_COLOURS[box.material]);
    }
    // Six names for the thirteen: a renderer that draws a mesh a name draws six.
    expect(new Set(boxes.map((box) => box.material)).size).toBe(6);
  });

  it("lays several boxes as one mesh: each box's own corners and triangles, a box after another", () => {
    const a = { name: "a", material: "crate", x: 0, y: 0, z: 0, width: 2, height: 2, depth: 2 };
    const b = { name: "b", material: "crate", x: 10, y: 1, z: -4, width: 1, height: 3, depth: 5 };
    const both = propBoxesGeometry([a, b]);
    const one = propBoxGeometry(a), two = propBoxGeometry(b);
    expect([...both.positions]).toEqual([...one.positions, ...two.positions]);
    expect([...both.normals]).toEqual([...one.normals, ...two.normals]);
    expect([...both.indices]).toEqual([...one.indices, ...[...two.indices].map((i) => i + 24)]);
    expect(propBoxesGeometry([]).positions).toHaveLength(0);
  });
});
