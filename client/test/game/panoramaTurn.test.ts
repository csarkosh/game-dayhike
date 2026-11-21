import { describe, expect, it } from "vitest";
import {
  PANORAMA_EYE_UP, PANORAMA_HEIGHT, PANORAMA_HEIGHT_M, PANORAMA_SECTORS, PANORAMA_SECTOR_WIDTH, PANORAMA_WIDTH, TURN_HOLD, TURN_IDLE, createPanoramaArming,
  createPanoramaTurn, panoramaFrustum, sectorYaw,
} from "@csarkosh/engine/game/panoramaTurn";
import { babylonValues } from "../helpers/babylonFixture.js";

/** The projection the shell on Babylon.js froze the shore panorama's camera at, in [0, 1] depth, for each radius, recorded. */
const SHELL = babylonValues<{ radii: number[]; matrices: number[][] }>("numbers/panoramaProjection.json");

describe("the shore panorama's numbers", () => {
  it("is sixteen sectors of 64 texels, 128 tall, from the skyline's eye to 64 m up the lake's cylinder", () => {
    expect([PANORAMA_WIDTH, PANORAMA_HEIGHT, PANORAMA_SECTORS, PANORAMA_SECTOR_WIDTH]).toEqual([1024, 128, 16, 64]);
    expect(PANORAMA_EYE_UP).toBe(0.4);
    expect(PANORAMA_HEIGHT_M).toBe(64);
  });

  it("frames a sector's turn across and the level to the reach up, the frustum shifted and never tilted", () => {
    const f = panoramaFrustum(40, { across: 0, up: 0, shift: 0 });
    // A sector's edge, tan(pi / 16) to the side, lands on the picture's edge.
    expect(f.across * Math.tan(Math.PI / PANORAMA_SECTORS)).toBeCloseTo(1, 12);
    // The level on the cylinder is the picture's foot and the reach its head.
    expect(f.up * (-PANORAMA_EYE_UP / 40) + f.shift).toBeCloseTo(-1, 12);
    expect(f.up * ((PANORAMA_HEIGHT_M - PANORAMA_EYE_UP) / 40) + f.shift).toBeCloseTo(1, 12);
    // Half way up the reach is the picture's middle row: rows run linearly with height.
    expect(f.up * ((PANORAMA_HEIGHT_M / 2 - PANORAMA_EYE_UP) / 40) + f.shift).toBeCloseTo(0, 12);
  });

  it("is what the projection recorded on Babylon.js is made from, term for term", () => {
    expect(SHELL.radii).toEqual([25, 40, 61.5, 120]);
    expect(SHELL.matrices).toHaveLength(4);
    for (const [at, radius] of SHELL.radii.entries()) {
      const f = panoramaFrustum(radius, { across: 0, up: 0, shift: 0 });
      const m = new Float32Array(SHELL.matrices[at] as number[]);
      expect(m).toHaveLength(16);
      // A matrix holds 32-bit floats.
      expect([m[0], m[5], m[9]]).toEqual([f.across, f.up, f.shift].map(Math.fround));
      expect([m[1], m[2], m[3], m[4], m[6], m[7], m[8], m[11], m[12], m[13], m[15]]).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
    }
  });

  it("faces each sector's middle, the first a thirty-second of a turn from +z", () => {
    expect(sectorYaw(0)).toBeCloseTo(Math.PI / 16, 12);
    expect(sectorYaw(15) - sectorYaw(14)).toBeCloseTo(Math.PI / 8, 12);
    expect(sectorYaw(15)).toBeCloseTo(2 * Math.PI - Math.PI / 16, 12);
  });
});

describe("createPanoramaTurn", () => {
  it("draws nothing until it is armed, then sixteen sectors in order, one a frame, and nothing after", () => {
    const turn = createPanoramaTurn();
    expect(turn.step(true)).toBe(TURN_IDLE);
    turn.rearm();
    const drawn: number[] = [];
    for (let i = 0; i < PANORAMA_SECTORS; i++) drawn.push(turn.step(true));
    expect(drawn).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(turn.remaining).toBe(0);
    expect(turn.step(true)).toBe(TURN_IDLE);
  });

  it("holds at its sector while its target cannot draw, and counts no sector for the wait", () => {
    const turn = createPanoramaTurn();
    turn.rearm();
    expect(turn.step(true)).toBe(0);
    expect(turn.step(false)).toBe(TURN_HOLD);
    expect(turn.step(false)).toBe(TURN_HOLD);
    expect(turn.remaining).toBe(15);
    expect(turn.step(true)).toBe(1);
  });

  it("continues the turn on a rearm mid-capture: sixteen more from the sector next due, so no column is older than sixteen frames", () => {
    const turn = createPanoramaTurn();
    turn.rearm();
    for (let i = 0; i < 5; i++) turn.step(true);
    turn.rearm();
    turn.rearm();
    expect(turn.remaining).toBe(PANORAMA_SECTORS);
    const drawn: number[] = [];
    for (let i = 0; i < PANORAMA_SECTORS; i++) drawn.push(turn.step(true));
    expect(drawn).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4]);
    expect(turn.step(true)).toBe(TURN_IDLE);
  });

  it("asks for nothing once it is ended", () => {
    const turn = createPanoramaTurn();
    turn.rearm();
    turn.step(true);
    turn.end();
    expect(turn.step(true)).toBe(TURN_IDLE);
    turn.rearm();
    expect(turn.remaining).toBe(0);
  });
});

describe("createPanoramaArming", () => {
  it("owes a capture from the start, and asks for it on the first frame the target is ready", () => {
    const arming = createPanoramaArming<object>();
    expect(arming.pending).toBe(true);
    expect(arming.step(null, false)).toBe(false);
    expect(arming.pending).toBe(true);
    expect(arming.step(null, true)).toBe(true);
    expect(arming.pending).toBe(false);
    expect(arming.step(null, true)).toBe(false);
  });

  it("asks again under each new sky state, once each, ready or not", () => {
    const arming = createPanoramaArming<object>();
    arming.step(null, true);
    const noon = {};
    expect(arming.step(noon, false)).toBe(true);
    expect(arming.step(noon, false)).toBe(false);
    expect(arming.step({}, false)).toBe(true);
  });

  it("asks again when something it draws lands late, on the frame the target is ready after it", () => {
    const arming = createPanoramaArming<object>();
    const sky = {};
    arming.step(sky, true);
    arming.landed();
    expect(arming.pending).toBe(true);
    expect(arming.step(sky, false)).toBe(false);
    expect(arming.step(sky, true)).toBe(true);
    expect(arming.step(sky, true)).toBe(false);
  });
});
