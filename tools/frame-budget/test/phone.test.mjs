import { describe, expect, it } from "vitest";
import { isAndroid, jobsOf, parseArgs, rowOf, stickTouches } from "../lib/phone.mjs";

const PIXEL_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36";
const RIG_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

describe("the phone harness's arguments", () => {
  it("defaults to one window, no settle, port 9222, tier low, and names the label and the tag", () => {
    const o = parseArgs(["--base", "https://games.csarko.sh/dayhike", "--out", "/tmp/x", "--views", "reveal,walk-night"]);
    expect(o).toMatchObject({ base: "https://games.csarko.sh/dayhike", out: "/tmp/x", views: ["reveal", "walk-night"], windows: 1, settle: 0, port: 9222, tier: "low", label: "phone", tag: "", profile: false });
    expect(parseArgs(["--base", "b", "--out", "o", "--windows", "3", "--settle", "20", "--port", "9333", "--tier", "medium", "--label", "pixel9", "--tag", "after", "--profile"])).toMatchObject({ windows: 3, settle: 20, port: 9333, tier: "medium", label: "pixel9", tag: "after", profile: true });
  });
  it("refuses a run without a base or an out directory, and an option it does not know", () => {
    expect(() => parseArgs(["--out", "o"])).toThrow(/--base/);
    expect(() => parseArgs(["--base", "b"])).toThrow(/--out/);
    expect(() => parseArgs(["--base", "b", "--out", "o", "--rotate", "1"])).toThrow(/unknown option --rotate/);
  });
});

describe("the joystick's touches", () => {
  it("starts on the base and moves up in six steps to the full deflection", () => {
    const points = stickTouches({ x: 81, y: 598 }, 60);
    expect(points).toHaveLength(7);
    expect(points[0]).toEqual({ x: 81, y: 598 });
    expect(points[6]).toEqual({ x: 81, y: 538 });
    expect(points.map((p) => p.y)).toEqual([598, 588, 578, 568, 558, 548, 538]);
  });
});

describe("the browser's user agent", () => {
  it("is Android's or the harness refuses it", () => {
    expect(isAndroid(PIXEL_UA)).toBe(true);
    expect(isAndroid(RIG_UA)).toBe(false);
  });
});

describe("a window's row", () => {
  it("summarises the frames, counts the slow ones and the stalls, and carries the phone's state", () => {
    const frames = [16.7, 16.7, 16.7, 25, 16.7, 120, 16.7, 16.7, 16.7, 16.7, 16.7];
    const row = rowOf(2, { frames, canvasStart: [250, 452], canvasEnd: [250, 452], dpr: 2.875, inner: [375, 679], gpu: "Mali-G715", readyS: 13.5, jobs: null },
      { browser: "Chrome/156.0.8078.80", label: "pixel9", tag: "after", base: "https://x", tier: "low", view: "walk-night", walking: true, phone: { batteryTempC: 37.4, thermalStatus: 1 } });
    expect(row).toMatchObject({ machine: "pixel9", tag: "after", browser: "Chrome/156.0.8078.80", gpu: "Mali-G715", tier: "low", view: "walk-night", window: 2, n: 11, over20: 2, stalls: 1, max: 120, canvas: { start: [250, 452], end: [250, 452] }, dpr: 2.875, inner: [375, 679], readyS: 13.5, walking: true, jobs: null, phone: { batteryTempC: 37.4, thermalStatus: 1 } });
    expect(row.mean).toBeCloseTo(26.85, 2);
    expect(row.fps).toBe(Math.round(1000 / row.mean));
    expect(row.frames).toHaveLength(11);
    expect(typeof row.time).toBe("string");
  });
});

describe("a window's jobs", () => {
  it("sums the frames' job milliseconds by owner and counts the frames with a late run", () => {
    const frames = [
      { jobs: { ms: 1.5, lateMs: 0, owners: { clipmap: 1.5 } } },
      { jobs: { ms: 4, lateMs: 2, owners: { clipmap: 3, forest: 1 } } },
      { jobs: null },
      { jobs: { ms: 0.5, lateMs: 0, owners: { forest: 0.5 } } },
    ];
    expect(jobsOf(frames)).toEqual({ ms: 6, lateMs: 2, frames: 4, lateFrames: 1, owners: { clipmap: 4.5, forest: 1.5 } });
    expect(jobsOf([{ jobs: null }, {}])).toBeNull();
  });
  it("refuses a window whose readings are all one and the same, which is a readout that aliased the scheduler's record", () => {
    const same = { ms: 7.3, lateMs: 0, owners: { idle: 7.3 } };
    const frames = Array.from({ length: 12 }, () => ({ jobs: { ...same, owners: { ...same.owners } } }));
    expect(() => jobsOf(frames)).toThrow(/alias/);
    // Two frames alike is nothing; a dozen with one of them different is a real window.
    expect(jobsOf(frames.slice(0, 2)).ms).toBeCloseTo(14.6, 9);
    expect(jobsOf([...frames.slice(0, 11), { jobs: { ms: 1, lateMs: 0, owners: { idle: 1 } } }]).ms).toBeCloseTo(81.3, 9);
  });
});
