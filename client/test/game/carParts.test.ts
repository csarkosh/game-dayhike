import { describe, expect, it } from "vitest";
import {
  DOOR_NAME, DOOR_SWING, STEERING_COLUMN, STEERING_NAME, WHEEL_NAMES, affineInverse, carPartTurn, doorTurn, frontWheel, partMatrix, poseVertices,
  wheelSpinTurn, wheelSteerTurn,
} from "../../src/game/carParts.js";
import { matrixMultiply } from "../../src/game/instancePose.js";
import { babylonValues } from "../helpers/babylonFixture.js";
import type { CarPose } from "../../src/game/scene/timeline.js";

const pose = (over: Partial<CarPose> = {}): CarPose => ({ x: 0, y: 0, z: 0, yaw: 0, wheelSpin: 0, doorOpen: 0, wheelTurn: 0, steer: 0, handset: "cradle", ...over });
/**
 * What Babylon.js's nodes and the stage on it gave, recorded. `frame`: the world matrix of a node turned, scaled
 * (1, 1.5, -1) and moved to (3, -2, 5). `parts`: four of the car's parts as nodes where the file has them, under the
 * model's own node turned a quarter, under a loader's root (it mirrors the file); of each its matrix in the model
 * (`local`), three vertices of its own frame with a normal and a tangent each as they rest in the model, and where
 * the same vertices and normal stood once the stage had turned the nodes by `pose`.
 */
const BABYLON = babylonValues<{
  frame: number[];
  pose: CarPose;
  parts: { name: string; local: number[]; positions: number[]; normals: number[]; tangents: number[]; wantPositions: number[]; wantNormals: number[] }[];
}>("numbers/carParts.json");

describe("the film's car's parts, as a pose turns them", () => {
  it("names the four wheels, the front pair first, the steering wheel and the driver's door", () => {
    expect(WHEEL_NAMES).toEqual(["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]);
    expect(WHEEL_NAMES.map(frontWheel)).toEqual([true, true, false, false]);
    expect([STEERING_NAME, DOOR_NAME]).toEqual(["wheel_steering", "door_driver"]);
    expect(DOOR_SWING).toBeCloseTo(Math.PI / 1.5, 12);
  });

  it("spins every wheel back about its axle, turns the front pair alone, and swings the door outward", () => {
    const p = pose({ wheelSpin: 3, wheelTurn: 0.2, doorOpen: 0.5 });
    expect(wheelSpinTurn(p)).toBe(-3);
    expect([wheelSteerTurn(p, true), wheelSteerTurn(p, false)]).toEqual([-0.2, 0]);
    expect(doorTurn(p)).toBeCloseTo(-0.5 * DOOR_SWING, 12);
    expect(carPartTurn("cradle", p, { x: 0, y: 0, z: 0, w: 1 })).toBeNull();
  });

  it("undoes a turn, a scale and a move", () => {
    // A mirrored, scaled, turned, moved frame, as a loader's root and a part's node make together.
    const m = new Float32Array(BABYLON.frame);
    expect([m[12], m[13], m[14]]).toEqual([3, -2, 5]);
    expect(Math.hypot(m[4] as number, m[5] as number, m[6] as number)).toBeCloseTo(1.5, 6);
    const inverse = affineInverse(m, new Float32Array(16));
    const one = new Float32Array(16);
    matrixMultiply(m, inverse, one);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    for (let i = 0; i < 16; i++) expect(one[i]).toBeCloseTo(identity[i] as number, 5);
  });

  it("carries a part's vertices where the stage on Babylon.js turns its node: under a mirrored root, a wheel spun and turned, the steering wheel about its column", () => {
    const staged = pose({ wheelSpin: 2.3, wheelTurn: 0.17, steer: 0.17 * 15, doorOpen: 0.4 });
    // The record is of this pose, and of a front wheel, a rear one, the steering wheel and the door.
    expect(BABYLON.pose).toEqual(staged);
    expect(BABYLON.parts.map((part) => part.name)).toEqual(["wheel_fl", "wheel_rl", "wheel_steering", "door_driver"]);
    const turn = { x: 0, y: 0, z: 0, w: 1 };
    const matrix = new Float32Array(16);
    for (const part of BABYLON.parts) {
      // Three vertices of the part as they rest in the model, with a normal and a tangent each, and the part's frame there.
      const rest = { positions: new Float32Array(part.positions), normals: new Float32Array(part.normals), tangents: new Float32Array(part.tangents) };
      const frame = new Float32Array(part.local);
      const q = carPartTurn(part.name, staged, turn);
      expect(q, part.name).not.toBeNull();
      const out = { positions: new Float32Array(9), normals: new Float32Array(9), tangents: new Float32Array(12) };
      poseVertices(partMatrix(frame, q as NonNullable<typeof q>, matrix), rest, out, 0, 3);
      // Where Babylon.js had the same vertices once the node was turned, the root's own place and turn (the pose's) taken out: the parts are turned in the model.
      expect([part.wantPositions.length, part.wantNormals.length]).toEqual([9, 9]);
      for (let i = 0; i < 3; i++) {
        for (let k = 0; k < 3; k++) {
          expect(out.positions[i * 3 + k], `${part.name} vertex ${i}`).toBeCloseTo(part.wantPositions[i * 3 + k] as number, 5);
          expect(out.normals[i * 3 + k], `${part.name} normal ${i}`).toBeCloseTo(part.wantNormals[i * 3 + k] as number, 5);
          expect(out.tangents[i * 4 + k], `${part.name} tangent ${i}`).toBeCloseTo(part.wantNormals[i * 3 + k] as number, 5);
        }
        // A tangent's handedness is carried as it is.
        expect(out.tangents[i * 4 + 3]).toBe(-1);
      }
    }
    // The column the steering wheel turns about is the stage's.
    expect(Math.hypot(...STEERING_COLUMN)).toBeGreaterThan(0.99);
  });

  it("leaves a run it is not asked for as it was", () => {
    const rest = { positions: new Float32Array([1, 2, 3, 4, 5, 6]), normals: new Float32Array([0, 1, 0, 0, 1, 0]), tangents: null };
    const out = { positions: new Float32Array(6), normals: new Float32Array(6), tangents: null };
    const move = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]);
    poseVertices(move, rest, out, 1, 1);
    expect([...out.positions]).toEqual([0, 0, 0, 14, 25, 36]);
    expect([...out.normals]).toEqual([0, 0, 0, 0, 1, 0]);
  });
});

import { TURNED_PART_NAMES, TURN_ROW_FLOATS, partMoved, partNumbers, restTurns, turnPoint, turnSlots, writeTurnRows, writeTurns } from "../../src/game/carParts.js";
import { composeInto, quatFromEuler } from "../../src/game/instancePose.js";

describe("the film's car's parts, as a vertex stage turns them", () => {
  /** A part's own frame in the model's: under a root that mirrors the file and a model turned a quarter, moved to where the file has the part. */
  const frame = (x: number, y: number, z: number): Float32Array => {
    const mirror = new Float32Array(16), model = new Float32Array(16), part = new Float32Array(16), out = new Float32Array(16);
    composeInto(mirror, 0, 1, 1, -1, { x: 0, y: 1, z: 0, w: 0 }, 0, 0, 0);
    composeInto(model, 0, 1, 1, 1, quatFromEuler(0, -Math.PI / 2, 0, { x: 0, y: 0, z: 0, w: 1 }), 0, 0, 0);
    composeInto(part, 0, 1, 1, 1, { x: 0, y: 0, z: 0, w: 1 }, x, y, z);
    matrixMultiply(model, part, out);
    matrixMultiply(mirror, out, out);
    return out;
  };
  const FRAMES: Record<string, Float32Array> = {
    wheel_fl: frame(1.326, 0.348, -0.73), wheel_fr: frame(1.326, 0.348, 0.73), wheel_rl: frame(-1.349, 0.348, -0.73), wheel_rr: frame(-1.349, 0.348, 0.73),
    wheel_steering: frame(0.594, 1.034, -0.411), door_driver: frame(0.875, 0.897, -0.752),
  };
  const run = (name: string): { name: string; local: Float32Array } => ({ name, local: FRAMES[name] as Float32Array });
  const stood = (): { wheelSpin: number; wheelTurn: number; steer: number; doorOpen: number } => ({ wheelSpin: 0, wheelTurn: 0, steer: 0, doorOpen: 0 });
  const f = Math.fround;

  it("names every part a pose turns, the wheels first", () => {
    expect(TURNED_PART_NAMES).toEqual(["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr", "wheel_steering", "door_driver"]);
  });

  it("gives each frame a part is turned in one turn, in the parts' own order whatever order the runs come in", () => {
    // As a car's meshes hold them: the door's panel in one mesh, a wheel and the steering wheel in others, the door's trim and its window in two more.
    const runs = [run("door_driver"), run("wheel_rl"), run("wheel_steering"), run("door_driver"), run("wheel_fl"), { name: "door_driver", local: Float32Array.from(FRAMES.door_driver as Float32Array) }];
    const { slots, of } = turnSlots(runs);
    expect(slots.map((slot) => slot.name)).toEqual(["wheel_fl", "wheel_rl", "wheel_steering", "door_driver"]);
    expect(of).toEqual([3, 1, 2, 3, 0, 3]);
    expect([...(slots[3] as (typeof slots)[number]).local]).toEqual([...(FRAMES.door_driver as Float32Array)]);
    // A primitive of a part that hangs in a frame of its own is turned in that frame: a turn of its own.
    const hung = turnSlots([run("door_driver"), { name: "door_driver", local: frame(0.9, 0.9, -0.75) }, run("wheel_fl")]);
    expect(hung.slots.map((slot) => slot.name)).toEqual(["wheel_fl", "door_driver", "door_driver"]);
    expect(hung.of).toEqual([1, 2, 0]);
    expect(() => turnSlots([{ name: "cradle", local: frame(0, 0, 0) }])).toThrow(/cradle/);
    expect(turnSlots([])).toEqual({ slots: [], of: [] });
  });

  it("numbers a mesh's vertices by the turn each takes: none for a vertex no pose turns", () => {
    expect([...partNumbers(9, [{ first: 2, count: 3, slot: 0 }, { first: 7, count: 1, slot: 4 }])]).toEqual([0, 0, 1, 1, 1, 0, 0, 5, 0]);
    expect([...partNumbers(3, [])]).toEqual([0, 0, 0]);
  });

  it("carries each vertex by its turn's rows where the processor's carrying of its run puts it, in the arithmetic of a vertex stage", () => {
    const names = ["wheel_steering", "door_driver", "wheel_rr", "wheel_fl", "wheel_fr", "wheel_rl"];
    const { slots, of } = turnSlots(names.map(run));
    // Three vertices a run in one mesh, with two before the first run that no pose turns: a position, a normal and a tangent each.
    const own = [[0.3, 0.1, 0.05], [-0.2, 0.25, -0.1], [0, -0.348, 0.12]] as const;
    const vertices = 2 + names.length * 3;
    const rest = { positions: new Float32Array(vertices * 3), normals: new Float32Array(vertices * 3), tangents: new Float32Array(vertices * 4) };
    rest.positions.set([5, 6, 7, -1, -2, -3]);
    rest.normals.set([0, 1, 0, 1, 0, 0]);
    rest.tangents.set([1, 0, 0, 1, 0, 0, 1, -1]);
    const runs = names.map((name, n) => {
      const local = FRAMES[name] as Float32Array;
      own.forEach((v, i) => {
        const at = 2 + n * 3 + i;
        for (let row = 0; row < 3; row++) {
          rest.positions[at * 3 + row] = v[0] * (local[row] as number) + v[1] * (local[4 + row] as number) + v[2] * (local[8 + row] as number) + (local[12 + row] as number);
          rest.normals[at * 3 + row] = 0.6 * (local[row] as number) + 0.8 * (local[4 + row] as number);
          rest.tangents[at * 4 + row] = 0.8 * (local[row] as number) - 0.6 * (local[4 + row] as number);
        }
        rest.tangents[at * 4 + 3] = i === 1 ? 1 : -1;
      });
      return { name, local, first: 2 + n * 3, count: 3, slot: of[n] as number };
    });
    const numbers = partNumbers(vertices, runs);
    const staged = pose({ wheelSpin: 2.3, wheelTurn: 0.17, steer: 0.17 * 15, doorOpen: 0.4 });
    const rows = restTurns(slots.length);
    expect(writeTurns(slots, stood(), staged, rows, { from: 0, to: 0 })).toBe(true);
    // The processor's carrying, a run at a time, as the car's meshes were sent.
    const sent = { positions: rest.positions.slice(), normals: rest.normals.slice(), tangents: rest.tangents.slice() };
    const turn = { x: 0, y: 0, z: 0, w: 1 };
    const matrix = new Float32Array(16);
    for (const r of runs) poseVertices(partMatrix(r.local, carPartTurn(r.name, staged, turn) as NonNullable<ReturnType<typeof carPartTurn>>, matrix), rest, sent, r.first, r.count);
    // A vertex stage's: single floats throughout, a vertex by the rows its number names, and a vertex numbered 0 as it stands.
    for (let v = 0; v < vertices; v++) {
      const number = numbers[v] as number;
      const row = (k: number, c: number): number => rows[(number - 1) * TURN_ROW_FLOATS + k * 4 + c] as number;
      for (let k = 0; k < 3; k++) {
        const carried = (from: Float32Array, stride: number, moved: boolean): number => {
          const x = from[v * stride] as number, y = from[v * stride + 1] as number, z = from[v * stride + 2] as number;
          if (number === 0) return [x, y, z][k] as number;
          const sum = f(f(f(x * row(k, 0)) + f(y * row(k, 1))) + f(z * row(k, 2)));
          return moved ? f(sum + row(k, 3)) : sum;
        };
        expect(carried(rest.positions, 3, true), `vertex ${v} position ${k}`).toBeCloseTo(sent.positions[v * 3 + k] as number, 5);
        expect(carried(rest.normals, 3, false), `vertex ${v} normal ${k}`).toBeCloseTo(sent.normals[v * 3 + k] as number, 5);
        expect(carried(rest.tangents, 4, false), `vertex ${v} tangent ${k}`).toBeCloseTo(sent.tangents[v * 4 + k] as number, 5);
      }
      // A tangent's handedness is no part of a turn.
      expect(sent.tangents[v * 4 + 3]).toBe(rest.tangents[v * 4 + 3]);
    }
    // The two vertices no pose turns stand where they stood; every turned one moved.
    expect([...sent.positions.subarray(0, 6)]).toEqual([5, 6, 7, -1, -2, -3]);
    expect([...numbers.subarray(0, 2)]).toEqual([0, 0]);
    for (let v = 2; v < vertices; v++) expect(Math.hypot(...[0, 1, 2].map((k) => (sent.positions[v * 3 + k] as number) - (rest.positions[v * 3 + k] as number)))).toBeGreaterThan(0.01);
  });

  it("holds a turn's rows as the part's matrix has them: a row a coordinate, its move the fourth float", () => {
    const rows = restTurns(2);
    expect([...rows]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    writeTurnRows([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 1], rows, 1);
    expect([...rows]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 4, 7, 10, 2, 5, 8, 11, 3, 6, 9, 12]);
    // A point by them is the matrix's own carrying of it: where a pane's middle goes with its door.
    const out = new Float32Array(4);
    turnPoint(rows, 1, 2, -1, 0.5, out, 1);
    expect([...out]).toEqual([0, 1 * 2 - 4 + 3.5 + 10, 2 * 2 - 5 + 4 + 11, 3 * 2 - 6 + 4.5 + 12]);
    turnPoint(rows, 0, 2, -1, 0.5, out, 0);
    expect([...out.subarray(0, 3)]).toEqual([2, -1, 0.5]);
  });

  it("writes the turns a pose has moved and no other: nothing for a car that stands, the door's alone for a door that swings, the wheels' and the steering wheel's for a car that drives", () => {
    const { slots } = turnSlots(TURNED_PART_NAMES.map(run));
    const rest = restTurns(slots.length);
    const rows = rest.slice();
    const was = stood();
    const range = { from: -1, to: -1 };
    // A pose it already stands at: no turn written, whatever else of the pose moves.
    expect(writeTurns(slots, was, pose({ x: 40, yaw: 1 }), rows, range)).toBe(false);
    expect([...rows]).toEqual([...rest]);
    expect(range).toEqual({ from: -1, to: -1 });
    // The door alone: the last turn's twelve floats, and every wheel's rows as they were.
    expect(writeTurns(slots, was, pose({ doorOpen: 0.5 }), rows, range)).toBe(true);
    expect(range).toEqual({ from: 5 * TURN_ROW_FLOATS, to: 6 * TURN_ROW_FLOATS });
    expect([...rows.subarray(0, 5 * TURN_ROW_FLOATS)]).toEqual([...rest.subarray(0, 5 * TURN_ROW_FLOATS)]);
    expect(was).toEqual({ wheelSpin: 0, wheelTurn: 0, steer: 0, doorOpen: 0.5 });
    expect(writeTurns(slots, was, pose({ doorOpen: 0.5 }), rows, range)).toBe(false);
    // Driving on, the door as it was: the four wheels and the steering wheel, one run of the floats, and not the door.
    const door = rows.slice(5 * TURN_ROW_FLOATS);
    expect(writeTurns(slots, was, pose({ doorOpen: 0.5, wheelSpin: 1, wheelTurn: 0.1, steer: 1.5 }), rows, range)).toBe(true);
    expect(range).toEqual({ from: 0, to: 5 * TURN_ROW_FLOATS });
    expect([...rows.subarray(5 * TURN_ROW_FLOATS)]).toEqual([...door]);
    // The front pair alone by a turn of the steering with no spin; the steering wheel by its own.
    expect(writeTurns(slots, was, pose({ doorOpen: 0.5, wheelSpin: 1, wheelTurn: 0.2, steer: 1.5 }), rows, range)).toBe(true);
    expect(range).toEqual({ from: 0, to: 2 * TURN_ROW_FLOATS });
    expect(writeTurns(slots, was, pose({ doorOpen: 0.5, wheelSpin: 1, wheelTurn: 0.2, steer: 3 }), rows, range)).toBe(true);
    expect(range).toEqual({ from: 4 * TURN_ROW_FLOATS, to: 5 * TURN_ROW_FLOATS });
    expect(partMoved("wheel_rl", stood(), pose({ wheelTurn: 0.2 }))).toBe(false);
    expect(partMoved("wheel_fl", stood(), pose({ wheelTurn: 0.2 }))).toBe(true);
    // Each written turn is the part's matrix at the pose, float for float.
    const turn = { x: 0, y: 0, z: 0, w: 1 };
    const matrix = new Float32Array(16);
    const want = restTurns(slots.length);
    for (const [at, slot] of slots.entries()) {
      writeTurnRows(partMatrix(slot.local, carPartTurn(slot.name, pose({ doorOpen: 0.5, wheelSpin: 1, wheelTurn: 0.2, steer: 3 }), turn) as NonNullable<ReturnType<typeof carPartTurn>>, matrix), want, at);
    }
    expect([...rows]).toEqual([...want]);
  });
});
