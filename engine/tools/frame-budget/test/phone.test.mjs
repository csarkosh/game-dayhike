import { describe, expect, it } from "vitest";
import { ACT_SCRIPT, STEER_STILL_S, STEER_SWIPE, createSteering, isAndroid, isCool, jobsOf, parseArgs, phoneState, rowOf, stickTouches, swipeTouches, waitUntilCool } from "../lib/phone.mjs";

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
  it("steers a walk only when asked", () => {
    expect(parseArgs(["--base", "b", "--out", "o"]).steer).toBe(false);
    expect(parseArgs(["--base", "b", "--out", "o", "--steer"]).steer).toBe(true);
  });
  it("forces an engine when asked, and only one the game knows", () => {
    expect(parseArgs(["--base", "b", "--out", "o"]).engine).toBeUndefined();
    expect(parseArgs(["--base", "b", "--out", "o", "--engine", "webgpu"]).engine).toBe("webgpu");
    expect(() => parseArgs(["--base", "b", "--out", "o", "--engine", "metal"])).toThrow(/webgpu or webgl2/);
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

describe("steering a walk", () => {
  it("counts the page's streaming slices and idle slices a frame, from the measurement mode's readout", () => {
    expect(ACT_SCRIPT).toContain("window.__syncJobs()");
    expect(ACT_SCRIPT).toContain("j.slices + j.idle");
    // Run against a page whose readout says two slices and one idle slice, over three frames.
    const frames = [];
    const window = { __syncJobs: () => ({ slices: 2, idle: 1 }), __act: -1 };
    const requestAnimationFrame = (f) => void frames.push(f);
    new Function("window", "requestAnimationFrame", ACT_SCRIPT)(window, requestAnimationFrame);
    expect(window.__act).toBe(0);
    for (let i = 0; i < 3; i++) frames.shift()?.();
    expect(window.__act).toBe(9);
  });
  it("turns the walker after three seconds with no streaming, and starts counting again", () => {
    const steering = createSteering();
    expect(STEER_STILL_S).toBe(3);
    // The count moves while the walker walks.
    expect([4, 9, 15, 21].map((n) => steering.feed(n))).toEqual([false, false, false, false]);
    // Then stands: three readings that equal the last make the turn, and the next three another.
    expect([21, 21, 21].map((n) => steering.feed(n))).toEqual([false, false, true]);
    expect([21, 21, 21].map((n) => steering.feed(n))).toEqual([false, false, true]);
    // A walker that moves again is not turned.
    expect([21, 21, 30, 30, 30].map((n) => steering.feed(n))).toEqual([false, false, false, false, false]);
  });
  it("swipes on a second touch, the joystick's finger held in every event, from the right half of the screen leftwards", () => {
    const held = { x: 81, y: 538 };
    const frames = swipeTouches(held);
    expect(frames).toHaveLength(STEER_SWIPE.steps + 1);
    for (const points of frames) {
      expect(points).toHaveLength(2);
      expect(points[0]).toEqual({ x: 81, y: 538, id: 1 });
      expect(points[1]?.id).toBe(2);
    }
    expect(frames[0]?.[1]).toEqual({ x: 340, y: 300, id: 2 });
    expect(frames[8]?.[1]).toEqual({ x: 80, y: 300, id: 2 });
    expect(frames.map((f) => f[1]?.x)).toEqual([340, 307.5, 275, 242.5, 210, 177.5, 145, 112.5, 80]);
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
    // Nothing of WebGPU's on a WebGL2 page.
    expect(row.wgsl).toBeNull();
    expect(row.pipes).toBeNull();
  });

  it("carries what the window added to the shader lookup's and the pipelines' counters on WebGPU", () => {
    const frames = Array.from({ length: 12 }, () => 16.7);
    const row = rowOf(0, {
      frames, canvasStart: [250, 452], canvasEnd: [250, 452], readyS: 9, ran: "webgpu",
      wgsl: { start: { hits: 140, misses: 0, translateMs: 0 }, end: { hits: 151, misses: 1, translateMs: 446.4 } },
      pipes: { start: { asked: 60, landed: 60, sync: 2, held: 6, leftOut: 700 }, end: { asked: 71, landed: 70, sync: 3, held: 9, leftOut: 760 } },
    }, { browser: "Chrome/156", label: "pixel9", tag: "", base: "https://x", tier: "low", view: "reveal" });
    expect(row.wgsl).toEqual({ hits: 11, misses: 1, translateMs: 446.4 });
    expect(row.pipes).toEqual({ asked: 11, landed: 10, sync: 1, held: 3, leftOut: 60 });
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
    expect(jobsOf(frames)).toMatchObject({ ms: 6, lateMs: 2, frames: 4, lateFrames: 1, owners: { clipmap: 4.5, forest: 1.5 } });
    expect(jobsOf([{ jobs: null }, {}])).toBeNull();
  });
  it("carries what the late share and the overdue bound did: slices, jobs, the longest slice and the learned apply cost", () => {
    const frames = [
      { jobs: { ms: 3, lateMs: 0, slices: 3, idle: 0, late: 0, lateJobs: 0, overdue: 0, overdueJobs: 0, owners: { clipmap: 3 }, longest: { clipmap: 1.2 }, learned: { clipmap: 1 } } },
      { jobs: { ms: 8, lateMs: 8, slices: 6, idle: 0, late: 6, lateJobs: 2, overdue: 0, overdueJobs: 0, owners: { clipmap: 5, forest: 3 }, longest: { clipmap: 1.5, forest: 2.8 }, learned: { clipmap: 1.2, forest: 2.8 } } },
      { jobs: { ms: 44.123, lateMs: 44.123, slices: 30, idle: 1, late: 0, lateJobs: 1, overdue: 30, overdueJobs: 1, owners: { clipmap: 44.123 }, longest: { clipmap: 12.345, forest: 2.8 }, learned: { clipmap: 1.5, forest: 2.8 } } },
    ];
    expect(jobsOf(frames)).toEqual({
      ms: 55.12, lateMs: 52.12, frames: 3, lateFrames: 2, owners: { clipmap: 52.12, forest: 3 },
      slices: 39, idle: 1, late: 6, lateJobs: 3, overdue: 30, overdueJobs: 1, overdueFrames: 1,
      // The last reading's: counted from the window's own start, and the cost the scheduler had learned by its end.
      longest: { clipmap: 12.35, forest: 2.8 }, learned: { clipmap: 1.5, forest: 2.8 },
    });
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

describe("a cool phone", () => {
  it("is cool only at thermal status 0 and a battery of 34.5 °C or less", () => {
    expect(isCool({ thermalStatus: 0, batteryTempC: 34.5 })).toBe(true);
    expect(isCool({ thermalStatus: 0, batteryTempC: 34.6 })).toBe(false);
    expect(isCool({ thermalStatus: 1, batteryTempC: 30 })).toBe(false);
    expect(isCool({ batteryTempC: 30 })).toBe(false);
    expect(isCool({})).toBe(false);
  });
  it("reads the battery and the thermal status from adb's text", () => {
    const run = (_cmd, args) => (args.includes("battery") ? "  level: 100\n  temperature: 354\n" : "IsStatusOverride: false\nThermal Status: 1\n");
    expect(phoneState(run)).toEqual({ batteryTempC: 35.4, thermalStatus: 1 });
  });
  it("waits, reading every 15 s, until the phone is cool", async () => {
    const readings = [{ thermalStatus: 1, batteryTempC: 36 }, { thermalStatus: 0, batteryTempC: 35 }, { thermalStatus: 0, batteryTempC: 34.4 }];
    let clock = 0;
    const r = await waitUntilCool({ read: () => readings.shift(), sleep: async (ms) => { clock += ms; }, now: () => clock });
    expect(r).toEqual({ cool: true, waitedS: 30, thermalStatus: 0, batteryTempC: 34.4 });
  });
  it("gives up after maxS and says the phone was not cool", async () => {
    let clock = 0;
    const r = await waitUntilCool({ maxS: 30, read: () => ({ thermalStatus: 0, batteryTempC: 36 }), sleep: async (ms) => { clock += ms; }, now: () => clock });
    expect(r.cool).toBe(false);
    expect(r.waitedS).toBe(30);
  });
  it("refuses at once when no phone answers", async () => {
    await expect(waitUntilCool({ read: () => ({}), sleep: async () => undefined, now: () => 0 })).rejects.toThrow(/no phone answers adb/);
  });
});
