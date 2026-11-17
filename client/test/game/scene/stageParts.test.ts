import { describe, expect, it } from "vitest";
import {
  CORD, CORD_PLUG, CORD_SOCKET, GRIP_OFFSET, GRIP_TURN, composeInto, cordEnds, decomposeInto, handsetCarry, handsetInCradle, multiplyInto, type Placed,
} from "../../../src/game/scene/stageParts.js";
import { babylonValues } from "../../helpers/babylonFixture.js";

const placed = (): Placed => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1] });

/**
 * What the stage on Babylon.js gave, recorded. The car as the loader leaves a model (a root that mirrors it, its
 * parts in the model's own frame: a cradle and, under it, a handset resting 0.041 m up), a hand as a skeleton's joint
 * is (under a mirrored armature a hundredth the model's size, turned, somewhere in the cab), and the stage moving
 * them, the car at coordinates of hundreds of metres. Every matrix is a node's in the world as Babylon.js held it, in
 * single floats.
 *
 * - `apart`: a turned, mirrored, moved matrix a hundredth the size, and what Babylon.js took it apart into.
 * - `sat`: for a handset in its cradle or in the hand at a grip, the cradle's and the hand's matrices and where the
 *   stage sat the handset (`want`).
 * - `frames`: the hand's and the cradle's matrices at a grip of 0.6, in the world and in the car's own frame (every
 *   matrix under the car's place undone).
 * - `carry`: the cradle's and the resting handset's matrices, a point of the handset where it rests (`resting`), and
 *   the same point once the stage had put the handset in the hand (`want`).
 * - `cord`: the cradle's and the held handset's matrices, and the first and last of the points the stage laid the
 *   cord along.
 */
const BABYLON = babylonValues<{
  apart: { m: number[]; scale: number[]; turn: number[]; place: number[] };
  sat: { handset: "cradle" | "hand"; grip: number; cradle: number[]; hand: number[] | null; want: number[] }[];
  frames: { grip: number; hand: number[]; cradle: number[]; handInCar: number[]; cradleInCar: number[] };
  carry: { own: number[]; cradle: number[]; rest: number[]; resting: number[]; hand: number[]; want: number[] };
  cord: { cradle: number[]; handset: number[]; first: number[]; last: number[]; points: number };
}>("numbers/stageParts.json");

/** A recorded matrix as the stage's arithmetic is handed one: the single floats Babylon.js held, as doubles. */
const floats = (m: readonly number[]): Float64Array => Float64Array.from(new Float32Array(m));

describe("the handset and its cord, as a stage places them", () => {
  it("holds the grip, the cord's ends and the cord the film was staged with", () => {
    expect(GRIP_OFFSET).toEqual([0.025, 0.075, 0.03]);
    expect(GRIP_TURN).toBeCloseTo(Math.PI / 2, 12);
    expect(CORD_SOCKET).toEqual([-0.0645, -0.012, 0.025]);
    expect(CORD_PLUG).toEqual([-0.0645, 0, 0]);
    expect(CORD).toEqual({ length: 0.6, maxSag: 0.04, radius: 0.006, turns: 20, points: 201 });
  });

  it("takes a matrix apart and puts it together again, a mirrored one too", () => {
    const { m, scale, turn, place } = BABYLON.apart;
    // The matrix is the mirrored one: a hundredth the size, at (3, -2, 5), one axis turned over.
    expect(place).toEqual([3, -2, 5]);
    expect(scale.map((s) => Math.sign(s))).toEqual([1, -1, 1]);
    const got = decomposeInto(floats(m), placed());
    for (let i = 0; i < 3; i++) {
      expect(got.scaling[i]).toBeCloseTo(scale[i] as number, 7);
      expect(got.position[i]).toBeCloseTo(place[i] as number, 6);
    }
    for (let i = 0; i < 4; i++) expect(got.rotation[i]).toBeCloseTo(turn[i] as number, 5);
    const again = composeInto(got, new Float64Array(16));
    const held = new Float32Array(m);
    for (let e = 0; e < 16; e++) expect(again[e]).toBeCloseTo(held[e] as number, 6);
  });

  it("sits the handset where the stage on Babylon.js sits it: in its cradle, in the fist, and part of the way between", () => {
    const rest: Placed = { position: [0, 0.041, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1] };
    const held = placed();
    const local = new Float64Array(16);
    const world = new Float64Array(16);
    expect(BABYLON.sat.map((s) => [s.handset, s.grip])).toEqual([["cradle", 0], ["hand", 1], ["hand", 0.35], ["hand", 0], ["cradle", 1]]);
    for (const { handset, grip, cradle: cradleWorld, hand, want: wanted } of BABYLON.sat) {
      const cradle = floats(cradleWorld);
      const want = new Float32Array(wanted);
      expect(hand === null).toBe(handset === "cradle");
      handsetInCradle(hand === null ? null : floats(hand), cradle, rest, grip, held);
      multiplyInto(cradle, composeInto(held, local), world);
      for (let e = 0; e < 16; e++) expect(world[e], `${handset} ${grip} float ${e}`).toBeCloseTo(want[e] as number, 3);
      // The place to a tenth of a millimetre, at coordinates of hundreds of metres in single floats.
      for (const e of [12, 13, 14]) expect(Math.abs((world[e] as number) - (want[e] as number))).toBeLessThan(2e-4);
    }
  });

  it("is the same handset told in the car's own frame as in the world's", () => {
    const { grip, hand, cradle, handInCar, cradleInCar } = BABYLON.frames;
    expect(grip).toBe(0.6);
    const rest: Placed = { position: [0, 0.041, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1] };
    const inWorld = handsetInCradle(floats(hand), floats(cradle), rest, 0.6, placed());
    // The car's own frame: every matrix under the car's place undone.
    expect(Math.hypot(cradle[12] as number, cradle[14] as number)).toBeGreaterThan(100);
    expect(Math.hypot(cradleInCar[12] as number, cradleInCar[14] as number)).toBeLessThan(1);
    const inCar = handsetInCradle(floats(handInCar), floats(cradleInCar), rest, 0.6, placed());
    for (let i = 0; i < 3; i++) {
      expect(inCar.position[i]).toBeCloseTo(inWorld.position[i] as number, 4);
      expect(inCar.scaling[i]).toBeCloseTo(inWorld.scaling[i] as number, 5);
    }
    for (let i = 0; i < 4; i++) expect(inCar.rotation[i]).toBeCloseTo(inWorld.rotation[i] as number, 4);
  });

  it("carries the handset's resting vertices to where its node would stand them", () => {
    const rest: Placed = { position: [0, 0.041, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1] };
    const cradle = floats(BABYLON.carry.cradle);
    const restWorld = floats(BABYLON.carry.rest);
    // A point of the handset's own, where Babylon.js stood it at rest and, below, in the hand.
    expect(BABYLON.carry.own).toEqual([0.02, -0.05, 0.01]);
    const [restingX, restingY, restingZ] = BABYLON.carry.resting as [number, number, number];
    // In its cradle the carry moves nothing.
    const still = handsetCarry(cradle, handsetInCradle(null, cradle, rest, 0, placed()), restWorld, new Float64Array(16));
    for (const [e, want] of [[0, 1], [5, 1], [10, 1], [12, 0], [13, 0], [14, 0], [1, 0], [6, 0]] as const) expect(still[e]).toBeCloseTo(want, 4);
    const want = BABYLON.carry.want as [number, number, number];
    const carry = handsetCarry(cradle, handsetInCradle(floats(BABYLON.carry.hand), cradle, rest, 1, placed()), restWorld, new Float64Array(16));
    const got = [
      restingX * carry[0]! + restingY * carry[4]! + restingZ * carry[8]! + carry[12]!,
      restingX * carry[1]! + restingY * carry[5]! + restingZ * carry[9]! + carry[13]!,
      restingX * carry[2]! + restingY * carry[6]! + restingZ * carry[10]! + carry[14]!,
    ];
    // Single floats at hundreds of metres carried through a matrix and back: a millimetre.
    for (let k = 0; k < 3; k++) expect(Math.abs((got[k] as number) - want[k]!)).toBeLessThan(2e-3);
    // And the hand did move it: the point in the hand is not the point at rest.
    expect(Math.hypot(want[0] - restingX, want[1] - restingY, want[2] - restingZ)).toBeGreaterThan(0.1);
  });

  it("ends the cord at the socket and the plug the stage lays it between", () => {
    const from = { x: 0, y: 0, z: 0 }, to = { x: 0, y: 0, z: 0 };
    cordEnds(floats(BABYLON.cord.cradle), floats(BABYLON.cord.handset), from, to);
    // The coil narrows to nothing at either end: the path's first and last points are the ends.
    for (const [i, k] of (["x", "y", "z"] as const).entries()) {
      expect(BABYLON.cord.first[i]).toBeCloseTo(from[k], 6);
      expect(BABYLON.cord.last[i]).toBeCloseTo(to[k], 6);
    }
    expect(BABYLON.cord.points).toBe(CORD.points);
  });
});
