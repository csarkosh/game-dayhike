import { describe, expect, it } from "vitest";
import {
  UPLOAD_BUDGET_BYTES, UPLOAD_KINDS, UPLOAD_WAIT_MS, createFrameUploads, uploadCountsCopy, type FrameUploads,
} from "../../../src/game/lite/frameUploads.js";
import { SYNC_BUDGET_MS, SYNC_LATE_FRAMES_MAX, createSyncJobs, finish, type Slices } from "../../../src/game/syncJobs.js";

const MB = 1024 * 1024;

/** A scheduler on a clock the test advances, with the uploads' record closed as each frame's jobs have run. */
function frames(uploads: FrameUploads, frameMs = 1000 / 60) {
  const time = { now: 0 };
  const jobs = createSyncJobs(() => time.now);
  const sent: number[] = [];
  const frame = (): void => {
    time.now += frameMs;
    jobs.run();
    uploads.close();
    sent.push(uploads.last.streamed);
  };
  return { jobs, frame, sent, time };
}

/** A build of `slices` slices that hands over `bytes` whole in its last, once the budget has room: as a shell's rebuild does. */
function* build(uploads: FrameUploads, bytes: number, shown: number[], slices = 2): Slices {
  for (let i = 0; i < slices; i++) yield;
  yield* uploads.hold(bytes);
  uploads.stream("instances", bytes);
  shown.push(bytes);
}

describe("what a frame of the hike's renderer on Babylon Lite hands to the GPU", () => {
  it("names its budget, and a wait as a slice longer than a frame's share", () => {
    expect(UPLOAD_BUDGET_BYTES).toBe(2 * MB);
    expect(UPLOAD_WAIT_MS).toBeGreaterThan(SYNC_BUDGET_MS);
  });

  it("counts a frame's bytes and writes by kind, streamed or not, and the rest of what the shells say", () => {
    const uploads = createFrameUploads();
    uploads.stream("instances", 6400);
    uploads.stream("pluginInstances", 1024);
    uploads.stream("geometry", 3000, 3);
    uploads.count("textures", 4096, 2);
    uploads.count("uniforms", 256);
    uploads.composed(100);
    uploads.made(2);
    uploads.dropped();
    uploads.marked(40);
    expect(uploads.now.bytes).toBe(6400 + 1024 + 3000 + 4096 + 256);
    expect(uploads.now.streamed).toBe(6400 + 1024 + 3000);
    expect(uploads.now.writes).toBe(1 + 1 + 3 + 2 + 1);
    expect(uploads.last.bytes).toBe(0);
    uploads.close();
    expect(uploads.frame).toBe(1);
    expect(uploads.last).toEqual({
      bytes: 14776, writes: 8, streamed: 10424,
      byKind: { instances: 6400, pluginInstances: 1024, geometry: 3000, pluginVertices: 0, textures: 4096, uniforms: 256 },
      instances: 100, meshesMade: 2, meshesDropped: 1, materialsMarked: 40, held: 0,
    });
    // The next frame begins from nothing, with the whole budget.
    expect(uploads.now.bytes).toBe(0);
    expect(Object.values(uploads.now.byKind)).toEqual(UPLOAD_KINDS.map(() => 0));
    expect(uploads.fits(UPLOAD_BUDGET_BYTES)).toBe(true);
    // A copy is its own: the records are written in place.
    const copy = uploadCountsCopy(uploads.last);
    uploads.close();
    expect(copy.bytes).toBe(14776);
    expect(copy.byKind.instances).toBe(6400);
    expect(uploads.last.bytes).toBe(0);
  });

  it("lets a frame's first streamed hand-over through whatever its size, and after it only what fits in what is left", () => {
    const uploads = createFrameUploads(2 * MB);
    expect(uploads.fits(5 * MB)).toBe(true);
    uploads.stream("geometry", 1.5 * MB);
    expect(uploads.fits(0.5 * MB)).toBe(true);
    expect(uploads.fits(0.5 * MB + 1)).toBe(false);
    // What is not streamed takes nothing from the budget.
    uploads.count("uniforms", 3 * MB);
    expect(uploads.fits(0.5 * MB)).toBe(true);
  });

  it("carries the hand-overs a frame has no room for over the frames after, each whole", () => {
    const uploads = createFrameUploads(2 * MB);
    const { jobs, frame, sent } = frames(uploads);
    const shown: number[] = [];
    // Four shells cross a line in one frame: together they would send 5.5 MB.
    for (const bytes of [1.5 * MB, 1.5 * MB, 1.5 * MB, 1 * MB]) jobs.begin({}, build(uploads, bytes, shown), false, "shell");
    for (let f = 0; f < 5; f++) frame();
    // One a frame, in the order they began; no frame over the budget, and the total what it was.
    expect(sent).toEqual([1.5 * MB, 1.5 * MB, 1.5 * MB, 1 * MB, 0]);
    expect(shown).toEqual([1.5 * MB, 1.5 * MB, 1.5 * MB, 1 * MB]);
    expect(Math.max(...sent)).toBeLessThanOrEqual(2 * MB);
    expect(sent.reduce((a, b) => a + b, 0)).toBe(5.5 * MB);
  });

  it("lets the small hand-overs share a frame", () => {
    const uploads = createFrameUploads(2 * MB);
    const { jobs, frame, sent } = frames(uploads);
    const shown: number[] = [];
    for (const bytes of [0.5 * MB, 0.75 * MB, 0.5 * MB, 0.5 * MB]) jobs.begin({}, build(uploads, bytes, shown), false, "shell");
    for (let f = 0; f < 3; f++) frame();
    expect(sent).toEqual([1.75 * MB, 0.5 * MB, 0]);
  });

  it("sends a hand-over larger than the whole budget alone, first in its frame, never split", () => {
    const uploads = createFrameUploads(2 * MB);
    const { jobs, frame, sent } = frames(uploads);
    const shown: number[] = [];
    jobs.begin({}, build(uploads, 0.5 * MB, shown), false, "small");
    jobs.begin({}, build(uploads, 5 * MB, shown), false, "rings");
    jobs.begin({}, build(uploads, 0.5 * MB, shown), false, "small");
    for (let f = 0; f < 3; f++) frame();
    // The frame the large one finds taken goes on to the small one behind it, as the scheduler's own slices do.
    expect(sent).toEqual([1 * MB, 5 * MB, 0]);
    expect(shown).toEqual([0.5 * MB, 0.5 * MB, 5 * MB]);
  });

  it("counts what a frame's own showings streamed before its jobs: a job waits where a cut has taken the room", () => {
    const uploads = createFrameUploads(2 * MB);
    const { jobs, frame, sent } = frames(uploads);
    const shown: number[] = [];
    jobs.begin({}, build(uploads, 1.5 * MB, shown, 0), false, "forest");
    // The frame's cut of the grass is shown as the frame is synced, ahead of its jobs.
    uploads.stream("instances", 1 * MB);
    frame();
    expect(shown).toEqual([]);
    expect(uploads.last.held).toBe(1);
    frame();
    expect(sent).toEqual([1 * MB, 1.5 * MB]);
  });

  it("does not hold a build run at once, nor a job the scheduler runs to its end because it is late", () => {
    const uploads = createFrameUploads(2 * MB);
    const shown: number[] = [];
    // At once: a first build, a jump.
    uploads.stream("geometry", 2 * MB);
    finish(build(uploads, 3 * MB, shown));
    expect(shown).toEqual([3 * MB]);
    expect(uploads.now.streamed).toBe(5 * MB);
    uploads.close();

    // A job kept waiting: every frame's own showings fill the budget before the jobs run.
    // Frames a millisecond apart, so the bound in frames is the one reached.
    const { jobs, frame, sent } = frames(uploads, 1);
    const late: number[] = [];
    jobs.begin({}, build(uploads, 1 * MB, late, 0), false, "forest");
    let waited = 0;
    while (late.length === 0) {
      uploads.stream("instances", 2 * MB);
      frame();
      waited++;
      expect(waited).toBeLessThanOrEqual(SYNC_LATE_FRAMES_MAX + 1);
    }
    // The game's bound on how far the picture trails the view comes first: shown in the frame the job is late.
    expect(waited).toBe(SYNC_LATE_FRAMES_MAX + 1);
    expect(sent.at(-1)).toBe(3 * MB);
  });
});
