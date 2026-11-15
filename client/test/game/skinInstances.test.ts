import { describe, expect, it } from "vitest";
import { CLIP_DRIFT_FRAMES, CLIP_FLOATS, SKIN_CLOCK_FOLD, clipRow, writeBodyMatrix, writeClipParams, type BakedClip } from "../../src/game/skinInstances.js";

/** A clip of 83 rows at 60 a second from row 153: 82 frames and the first again. */
const WALK: BakedClip = { fromRow: 153, frames: 83, fps: 60, seconds: 82 / 60 };

describe("a body's place in its clip, as the vertex stage reads it", () => {
  it("reads the frame its clip's clock says, at any count of the shared clock", () => {
    const params = new Float32Array(CLIP_FLOATS * 2);
    for (const clock of [0, 0.5, 17.25, SKIN_CLOCK_FOLD - 0.01]) {
      params.fill(0);
      expect(writeClipParams(params, 1, WALK, 0.4, 1, clock, true)).toBe(true);
      expect(clipRow(params, 1, clock)).toBe(153 + 24);
    }
  });

  it("plays on with the shared clock at its rate and loops on the clip's length, its last row left out", () => {
    const params = new Float32Array(CLIP_FLOATS);
    writeClipParams(params, 0, WALK, 0, 2, 10, true);
    expect(clipRow(params, 0, 10)).toBe(153);
    expect(clipRow(params, 0, 10 + 0.25)).toBe(153 + 30);
    // 82 frames at 120 a second: the clip is back at its start after 82 / 120 s, never on its 83rd row. A row is
    // the baked frame nearest the clip's time.
    expect(clipRow(params, 0, 10 + 81.2 / 120)).toBe(153 + 81);
    expect(clipRow(params, 0, 10 + 82.25 / 120)).toBe(153);
    expect(params[1]).toBe(153 + 81);
  });

  it("leaves a body's floats alone while it plays on, and writes them when its rate, its clip or its time jumps", () => {
    const params = new Float32Array(CLIP_FLOATS);
    expect(writeClipParams(params, 0, WALK, 0.2, 1.5, 3, true)).toBe(true);
    // A frame later on both clocks: the same floats would say the same row.
    expect(writeClipParams(params, 0, WALK, 0.2 + 0.016 * 1.5, 1.5, 3.016, true)).toBe(false);
    expect(writeClipParams(params, 0, WALK, 0.2 + 0.032 * 1.5, 1.6, 3.032, true)).toBe(true);
    const idle: BakedClip = { fromRow: 0, frames: 153, fps: 60, seconds: 152 / 60 };
    expect(writeClipParams(params, 0, idle, 0, 1, 3.048, true)).toBe(true);
    expect(writeClipParams(params, 0, idle, 1, 1, 3.048, true)).toBe(true);
    // A drift of less than a quarter of a frame is left; more is written.
    expect(writeClipParams(params, 0, idle, 1 + (CLIP_DRIFT_FRAMES * 0.9) / 60, 1, 3.048, true)).toBe(false);
    expect(writeClipParams(params, 0, idle, 1 + (CLIP_DRIFT_FRAMES * 1.2) / 60, 1, 3.048, true)).toBe(true);
  });

  it("holds a clip that does not loop on its last row once it has run", () => {
    const params = new Float32Array(CLIP_FLOATS);
    const death: BakedClip = { fromRow: 300, frames: 147, fps: 60, seconds: 146 / 60 };
    writeClipParams(params, 0, death, 1, 1, 0, false);
    expect(clipRow(params, 0, 0)).toBe(360);
    writeClipParams(params, 0, death, 9, 1, 5, false);
    expect(clipRow(params, 0, 5)).toBe(446);
    expect(clipRow(params, 0, 500)).toBe(446);
  });

  it("brings a clip round in its own length where that is no whole number of frames", () => {
    // 0.248 s at 60 a second: 14.88 frames, baked as sixteen rows.
    const run: BakedClip = { fromRow: 40, frames: 16, fps: 60, seconds: 0.248 };
    const params = new Float32Array(CLIP_FLOATS);
    writeClipParams(params, 0, run, 0, 1, 0, true);
    expect((params[1] as number) - (params[0] as number) + 1).toBeCloseTo(14.88, 4);
    // Ten times round is 2.48 s: the clip is at its start again, and never on the rows past its end.
    expect(clipRow(params, 0, 2.48 + 0.2 / 60)).toBe(40);
    for (let i = 0; i < 400; i++) expect(clipRow(params, 0, i * 0.0131)).toBeLessThan(40 + 15);
  });

  it("mixes in no second clip", () => {
    const params = new Float32Array(CLIP_FLOATS);
    writeClipParams(params, 0, WALK, 0.4, 1, 2, true);
    expect([params[4], params[5], params[6]]).toEqual([153, 153 + 81, 0]);
  });
});

describe("a body's matrix", () => {
  it("stands it at its place, scaled, turned +Z toward +X by its yaw", () => {
    const out = new Float32Array(32);
    writeBodyMatrix(out, 1, 3, 4, 5, Math.PI / 2, 2);
    const m = out.subarray(16);
    const carry = (x: number, y: number, z: number): number[] => [x * m[0]! + y * m[4]! + z * m[8]! + m[12]!, x * m[1]! + y * m[5]! + z * m[9]! + m[13]!, x * m[2]! + y * m[6]! + z * m[10]! + m[14]!];
    const forward = carry(0, 0, 1);
    expect(forward[0]).toBeCloseTo(3 + 2, 5);
    expect(forward[1]).toBeCloseTo(4, 5);
    expect(forward[2]).toBeCloseTo(5, 5);
    expect(carry(0, 1, 0)[1]).toBeCloseTo(4 + 2, 5);
    expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1]);
    expect([...out.subarray(0, 16)]).toEqual(new Array(16).fill(0));
  });
});
