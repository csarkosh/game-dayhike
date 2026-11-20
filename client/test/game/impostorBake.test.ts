import { describe, expect, it } from "vitest";
import {
  IMPOSTOR_BAKE_FAIL_MS, IMPOSTOR_BAKE_SIZE, IMPOSTOR_BAKE_WARN_MS, SNAG_BAKE_ROLL, bakePoseMatrix, impostorBakeFrame, impostorName, posedBounds,
} from "@csarkosh/engine/game/impostorBake";
import { deadwoodMeasure, impostorQuad, snagImpostorQuad } from "../../src/game/forestInstances.js";

/** A trunk lying along x from -1.5 to 2.5, its section 1 m up and 0.8 m through. */
function trunk(): number[] {
  const positions: number[] = [];
  for (let s = 0; s <= 20; s++) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      positions.push(-1.5 + s * 0.2, 0.5 * Math.sin(a), 0.4 * Math.cos(a));
    }
  }
  return positions;
}

describe("a far tree's bake", () => {
  it("is two pictures of 512 a side, warned of at half a minute and given up at two", () => {
    expect(IMPOSTOR_BAKE_SIZE).toBe(512);
    expect(IMPOSTOR_BAKE_WARN_MS).toBe(30_000);
    expect(IMPOSTOR_BAKE_FAIL_MS).toBe(120_000);
  });

  it("names a billboard by its cohort and slot", () => {
    expect(impostorName("giant_0")).toBe("forest_impostor_giant_0");
    expect(impostorName("snag")).toBe("forest_impostor_snag");
  });

  it("frames a tree side-on: its height by its widest horizontal extent, seen along +z from two depths off", () => {
    const min = { x: -2, y: 0, z: -3 };
    const max = { x: 4, y: 20, z: 5 };
    const frame = impostorBakeFrame(min, max);
    expect(frame).toEqual({
      width: 8, height: 20,
      centre: { x: 1, y: 10, z: 1 },
      eye: { x: 1, y: 10, z: 1 - 16 },
      near: 0.01, far: 32,
    });
    // The picture's square is the quad the billboard draws.
    const quad = impostorQuad(min, max);
    expect([quad.width, quad.height, quad.centreY]).toEqual([frame?.width, frame?.height, frame?.centre.y]);
  });

  it("stands no nearer than two metres off a thin tree, and frames nothing of a box with no width or no height", () => {
    const thin = impostorBakeFrame({ x: -0.1, y: 0, z: -0.1 }, { x: 0.1, y: 3, z: 0.1 });
    expect(thin?.eye.z).toBeCloseTo(-2, 12);
    expect(thin?.far).toBe(4);
    expect(impostorBakeFrame({ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 0 })).toBeNull();
    expect(impostorBakeFrame({ x: -1, y: 2, z: -1 }, { x: 1, y: 2, z: 1 })).toBeNull();
    expect(impostorBakeFrame({ x: Infinity, y: Infinity, z: Infinity }, { x: -Infinity, y: -Infinity, z: -Infinity })).toBeNull();
  });

  it("bakes the snag stood up: the roll that carries the model's x onto y", () => {
    expect(SNAG_BAKE_ROLL).toBe(Math.PI / 2);
    const pose = bakePoseMatrix(SNAG_BAKE_ROLL);
    // Column major: the model's x axis lands on +y, its y axis on -x, z stays.
    expect(pose[0]).toBeCloseTo(0, 6);
    expect(pose[1]).toBeCloseTo(1, 6);
    expect(pose[4]).toBeCloseTo(-1, 6);
    expect(pose[5]).toBeCloseTo(0, 6);
    expect(pose[10]).toBeCloseTo(1, 6);
    expect([pose[12], pose[13], pose[14], pose[15]]).toEqual([0, 0, 0, 1]);
    expect([...bakePoseMatrix(0)]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it("frames the posed snag as the quad its billboard draws: the trunk's length up, its section across", () => {
    const positions = trunk();
    const bounds = posedBounds(bakePoseMatrix(SNAG_BAKE_ROLL), [positions.slice(0, 240), positions.slice(240)]);
    expect(bounds.min.y).toBeCloseTo(-1.5, 5);
    expect(bounds.max.y).toBeCloseTo(2.5, 5);
    expect(bounds.min.x).toBeCloseTo(-0.5, 5);
    expect(bounds.max.x).toBeCloseTo(0.5, 5);
    const frame = impostorBakeFrame(bounds.min, bounds.max);
    const quad = snagImpostorQuad(deadwoodMeasure(positions));
    expect(frame?.width).toBeCloseTo(quad.width, 5);
    expect(frame?.height).toBeCloseTo(quad.height, 5);
  });

  it("leaves an unposed model's box as it is", () => {
    const bounds = posedBounds(bakePoseMatrix(0), [[1, 2, 3, -4, 5, 6]]);
    expect(bounds).toEqual({ min: { x: -4, y: 2, z: 3 }, max: { x: 1, y: 5, z: 6 } });
  });
});
