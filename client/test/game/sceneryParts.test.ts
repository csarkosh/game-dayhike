import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BOARD_FACE } from "../../src/game/boardFace.js";
import { glbParts } from "../../src/game/glbParts.js";
import {
  BOARD_FACE_LIFT, BODY_OUTPUT, BODY_STAND_IN, CAB_PARTS, CAB_SKY, FILM_CAR_OUTPUT, TRAILHEAD_CAR_OUTPUT, TRAILHEAD_KIOSK_OUTPUT, boardFaceCorners, boardYaw,
  carYaw,
} from "../../src/game/sceneryParts.js";
import { babylonValues } from "../helpers/babylonFixture.js";

const bytesOf = (output: string): Buffer => readFileSync(new URL(`../../assets/${output}`, import.meta.url));

const groundH = (x: number, z: number): number => 3 + 0.01 * x - 0.02 * z;
/**
 * What the shells on Babylon.js gave, recorded. `boards`: for a board on ground of a height, the trailhead's shell
 * built with the shipped models, and of its painted plane the four corners in the world by their texture
 * coordinates ((0, 0), (1, 0), (1, 1), (0, 1)) and the way the plane looks (`normal`). `cabSky`: how much of the
 * sky the stage on Babylon.js gave the cab's plain parts.
 */
const BABYLON = babylonValues<{
  boards: { board: { x: number; z: number; fx: number; fz: number; ax: number; az: number }; groundY: number; corners: number[]; normal: number[] }[];
  cabSky: number;
}>("numbers/sceneryParts.json");

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

  it("stands the painted face where the record of the board on Babylon.js has its plane, corner for corner", () => {
    const boards = [
      { x: 6, z: 39, fx: 0, fz: -1, ax: 1, az: 0 },
      { x: -265.2, z: -6.6, fx: -0.8630244082664948, fz: 0.5051622221982427, ax: -0.5051622221982427, az: -0.8630244082664948 },
    ];
    // The record is of these two boards, each on this ground.
    expect(BABYLON.boards.map((recorded) => recorded.board)).toEqual(boards);
    for (const [b, board] of boards.entries()) {
      const theirs = BABYLON.boards[b] as (typeof BABYLON.boards)[number];
      expect(theirs.groundY).toBe(groundH(board.x, board.z));
      expect(theirs.corners).toHaveLength(12);
      const ours = boardFaceCorners(board, groundH(board.x, board.z));
      for (let c = 0; c < 4; c++) {
        expect(ours.corners[c * 3]).toBeCloseTo(theirs.corners[c * 3] as number, 4);
        expect(ours.corners[c * 3 + 1]).toBeCloseTo(theirs.corners[c * 3 + 1] as number, 4);
        expect(ours.corners[c * 3 + 2]).toBeCloseTo(theirs.corners[c * 3 + 2] as number, 4);
      }
      expect(ours.normal.x).toBeCloseTo(theirs.normal[0] as number, 5);
      expect(ours.normal.z).toBeCloseTo(theirs.normal[2] as number, 5);
      // The face looks the way the board faces, the lift in front of the model's planks.
      expect(ours.normal.x).toBeCloseTo(board.fx, 6);
      expect(ours.normal.z).toBeCloseTo(board.fz, 6);
      const centre = { x: 0, z: 0 };
      for (let c = 0; c < 4; c++) {
        centre.x += (ours.corners[c * 3] as number) / 4;
        centre.z += (ours.corners[c * 3 + 2] as number) / 4;
      }
      expect((centre.x - board.x) * board.fx + (centre.z - board.z) * board.fz).toBeCloseTo(BOARD_FACE.front + BOARD_FACE_LIFT, 5);
    }
  });

  it("dims the cab's plain parts by the stage's own number, and finds them in the film's car", () => {
    expect(CAB_SKY).toBe(BABYLON.cabSky);
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
