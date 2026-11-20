import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { RING_CELLS, WEIGHTS2_STRIDE, createRingSamples, ringGeometry, ringGeometryBuffers } from "@csarkosh/engine/game/clipmap";
import { facePatchGeometry, type PatchStitch } from "@csarkosh/engine/game/facePatches";
import {
  TERRAIN_ATTRIBUTES, TERRAIN_VERTEX_SIZES, facePatchVertices, ringVertices, type TerrainVertices,
} from "@csarkosh/engine/game/terrainVertices";
import { timeLimit } from "../helpers/timeLimit.js";

const ATTRIBUTES = ["positions", "normals", "colors", "weights", "weights2", "cover"] as const;

/** Every attribute's array holds its floats a vertex for the same count of vertices, and no index reaches past them. */
function expectWhole(v: TerrainVertices, vertices: number): void {
  for (const name of ATTRIBUTES) expect(v[name].length, name).toBe(vertices * TERRAIN_VERTEX_SIZES[name]);
  expect(v.indices.length % 3).toBe(0);
  let top = 0;
  for (const i of v.indices) top = Math.max(top, i);
  expect(top).toBeLessThan(vertices);
}

describe("a terrain mesh's vertex data", () => {
  it("is three floats of position and of normal, four of colour and of each weight set, one of cover", () => {
    expect(TERRAIN_VERTEX_SIZES).toEqual({ positions: 3, normals: 3, colors: 4, weights: 4, weights2: WEIGHTS2_STRIDE, cover: 1 });
    expect(TERRAIN_ATTRIBUTES).toEqual({ weights: "terrainWeights", weights2: "terrainWeights2", cover: "terrainCover" });
  });

  it("is a ring's own arrays, every index drawn where no ground is covered", { timeout: timeLimit(60_000) }, () => {
    const g = ringGeometry(createRingSamples(0x717e, 4, 0, 0), null, null);
    const v = ringVertices(g);
    for (const name of ATTRIBUTES) expect(v[name], name).toBe(g[name]);
    expect(v.indices).toBe(g.indices);
    expectWhole(v, (RING_CELLS + 1) * (RING_CELLS + 1));
  });

  it("is a ring's drawn indices alone where some are left out, a view of its buffer", () => {
    const g = ringGeometryBuffers(false);
    for (let i = 0; i < g.indices.length; i++) g.indices[i] = i % 7;
    g.indexCount = 12;
    const v = ringVertices(g);
    expect(v.indices).toHaveLength(12);
    expect(v.indices.buffer).toBe(g.indices.buffer);
    expect(Array.from(v.indices)).toEqual(Array.from(g.indices.subarray(0, 12)));
    expect(v.positions).toBe(g.positions);
  });

  it("is a patch's own arrays, every index drawn", { timeout: timeLimit(60_000) }, () => {
    const none: PatchStitch = { west: false, east: false, north: false, south: false, open: 0 };
    const patch = facePatchGeometry(627994160, -24, -57, 1, none)!;
    const v = facePatchVertices(patch);
    for (const name of ATTRIBUTES) expect(v[name], name).toBe(patch[name]);
    expect(v.indices).toBe(patch.indices);
    expect(v.indices).toHaveLength(patch.triangleCount * 3);
    expectWhole(v, patch.vertexCount);
  });
});
