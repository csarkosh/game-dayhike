import { describe, expect, it } from "vitest";
import type { Dragonflies } from "@csarkosh/engine/game/dragonflyBehaviour";
import {
  DRAGONFLY_COLOURS, DRAGONFLY_DRAWN_SCALE, DRAGONFLY_WING_AMP, dragonflyGeometry, dragonflyHalfSpan, emptyDragonflyList, fillDragonflyList,
} from "@csarkosh/engine/game/dragonflyShapes";
import { MIDGE_DARK, MIDGE_FRAME_FLOATS, MIDGE_HEAD_FLOATS, MIDGE_TABLE_FLOATS, midgeSlots, packMidgeFrame, type MidgeFrame } from "../../src/game/midgeLook.js";
import { MIDGE_SWARMS_MAX, SWARM_ROW_FLOATS } from "../../src/game/midgeMotion.js";

const SEED = 388817;

describe("the midges' one draw's inputs", () => {
  it("lays an instance a midge by row and slot, and refuses more rows than the table holds", () => {
    const { slots, total } = midgeSlots([2, 0, 3]);
    expect(total).toBe(5);
    expect([...slots]).toEqual([0, 0, 0, 1, 2, 0, 2, 1, 2, 2]);
    expect(() => midgeSlots(new Array<number>(MIDGE_SWARMS_MAX + 1).fill(1))).toThrow(/rows/);
  });

  it("packs a frame as five vec4s and the table, in the order the stages read them", () => {
    expect(MIDGE_TABLE_FLOATS).toBe(SWARM_ROW_FLOATS * MIDGE_SWARMS_MAX);
    expect(MIDGE_FRAME_FLOATS).toBe(MIDGE_HEAD_FLOATS + MIDGE_TABLE_FLOATS);
    const table = Float32Array.from({ length: MIDGE_TABLE_FLOATS }, (_, i) => i + 100);
    const frame: MidgeFrame = {
      eyeX: 1, eyeY: 2, eyeZ: 3, time: 4, sunX: 5, sunY: 6, sunZ: 7, sunR: 8, sunG: 9, sunB: 10, glowR: 11, glowG: 12, glowB: 13, night: 14, skyLuma: 15,
      pixelAt1m: 16, table,
    };
    const out = packMidgeFrame(frame, 17, true, 18, new Float32Array(MIDGE_FRAME_FLOATS));
    expect([...out.subarray(0, MIDGE_HEAD_FLOATS)]).toEqual([1, 2, 3, 4, 5, 6, 7, 14, 8, 9, 10, 15, 11, 12, 13, 16, 17, 1, 18, 0]);
    expect([...out.subarray(MIDGE_HEAD_FLOATS)]).toEqual([...table]);
    expect(packMidgeFrame(frame, 17, false, 18, out)[17]).toBe(0);
  });

  it("hides nine tenths of the background behind a speck against the brightest sky", () => {
    expect(MIDGE_DARK).toBe(0.9);
  });
});

describe("the dragonflies as lists", () => {
  const units: Dragonflies = {
    count: [2, 0, 1],
    poses: [
      [{ x: 1, y: 2, z: 3, yaw: 0, pitch: 0, perched: false, id: 7 }, { x: 4, y: 5, z: 6, yaw: Math.PI / 2, pitch: 0, perched: true, id: 8 }],
      [],
      [{ x: -1, y: 0, z: 9, yaw: 0, pitch: 0.2, perched: false, id: 2 * 4096 + 3 }],
    ],
    rustles: [],
    step() {},
  };

  it("writes a unit as its matrix at three times life size, its wing's phase and beat, and a colourway of its kind", () => {
    const list = fillDragonflyList(emptyDragonflyList(), units, 0, SEED);
    expect(list.count).toBe(2);
    expect(list.grown).toBe(true);
    expect([list.matrices[0], list.matrices[5], list.matrices[10]]).toEqual([DRAGONFLY_DRAWN_SCALE, DRAGONFLY_DRAWN_SCALE, DRAGONFLY_DRAWN_SCALE]);
    expect([list.matrices[12], list.matrices[13], list.matrices[14]]).toEqual([1, 2, 3]);
    // The second faces +x: its own z axis lies along the world's x.
    expect(list.matrices[16 + 8]).toBeCloseTo(DRAGONFLY_DRAWN_SCALE, 5);
    expect(list.wing[1]).toBe(Math.fround(DRAGONFLY_WING_AMP));
    expect(list.wing[3]).toBe(0);
    for (let i = 0; i < 2; i++) {
      const way = DRAGONFLY_COLOURS[0]?.[list.way[i] as number] as readonly number[];
      expect([...list.tint.subarray(i * 4, i * 4 + 4)]).toEqual([...Float32Array.of(way[0] as number, way[1] as number, way[2] as number, 1)]);
      expect(list.wing[i * 2]).toBeGreaterThanOrEqual(0);
      expect(list.wing[i * 2]).toBeLessThan(2 * Math.PI);
    }
    // The same units again: the buffers are kept, and an individual keeps its phase and its colourway.
    const phase = list.wing[0];
    const way = list.way[0];
    const matrices = list.matrices;
    fillDragonflyList(list, units, 0, SEED);
    expect(list.grown).toBe(false);
    expect(list.matrices).toBe(matrices);
    expect([list.wing[0], list.way[0]]).toEqual([phase, way]);
    expect(fillDragonflyList(emptyDragonflyList(), units, 1, SEED).count).toBe(0);
  });

  it("measures a card's half span as its farthest vertex from the body's axis", () => {
    const shape = dragonflyGeometry(0);
    let widest = 0;
    for (let i = 0; i < shape.positions.length; i += 3) widest = Math.max(widest, Math.abs(shape.positions[i] as number));
    expect(dragonflyHalfSpan(shape.positions)).toBe(widest);
    expect(widest).toBeGreaterThan(0.03);
  });
});
