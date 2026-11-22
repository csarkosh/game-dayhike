import { describe, expect, it } from "vitest";
import { TRACE_CATEGORIES, gpuCallTotals, gpuMainTasks, keepForGpu, pageClockOffset, skipsWithHolds, traceExtent, traceNote, traceReader } from "../lib/gpuTrace.mjs";

/** The trace's clock is this many microseconds ahead of the page's. */
const OFFSET = 500_000_000;
/** A page time (ms) on the trace's clock (µs). */
const us = (pageMs) => OFFSET + pageMs * 1000;
const meta = (pid, tid, kind, name) => ({ ph: "M", pid, tid, name: kind, args: { name } });
const slice = (pid, tid, ts, durMs, name, args) => ({ ph: "X", pid, tid, ts, dur: durMs * 1000, name, cat: "toplevel", ...(args ? { args } : {}) });
const PROBE = "RenderPipeline_rgba16float_depth32float_samples1_textureState0";

// A start as one traced on a Pixel 9 went (2026-11-12): the hike's first frame held the GPU thread 96 ms.
const EVENTS = [
  meta(10, 10, "process_name", "GPU Process"), meta(10, 1, "thread_name", "CrGpuMain"), meta(10, 2, "thread_name", "VizCompositorThread"),
  meta(20, 20, "process_name", "Renderer"), meta(20, 1, "thread_name", "CrRendererMain"),
  // The page's three longest frames, as tasks of its main thread.
  slice(20, 1, us(1500), 200, "ThreadControllerImpl::RunTask"), slice(20, 1, us(2500), 150, "ThreadControllerImpl::RunTask"), slice(20, 1, us(4000), 120, "ThreadControllerImpl::RunTask"),
  // The GPU thread: the first frame's batch, and a short one.
  slice(10, 1, us(6000), 96, "ThreadControllerImpl::RunTask"),
  slice(10, 1, us(6000), 96, "WebGPUDecoderImpl::HandleDawnCommands"),
  slice(10, 1, us(6005), 55, "DeviceBase::APICreateRenderPipeline", { label: PROBE }),
  slice(10, 1, us(6010), 8, "ShaderModuleVk::GetHandleAndSpirv"),
  slice(10, 1, us(6062), 22, "Queue::Submit"),
  slice(10, 1, us(6090), 1, "DeviceBase::APICreateShaderModule", { label: "vertex tiny" }),
  slice(10, 1, us(7000), 30, "ThreadControllerImpl::RunTask"),
  // The same names on another thread of the GPU process are not the GPU thread's.
  slice(10, 2, us(8000), 100, "ThreadControllerImpl::RunTask"),
  slice(10, 2, us(8000), 90, "DeviceBase::APICreateShaderModule", { label: "fragment pbr" }),
];
const TEXT = JSON.stringify({ traceEvents: [...EVENTS, { ph: "X", pid: 10, tid: 1, ts: 1, dur: 2000, name: 'odd "{name}" \\ here', args: { big: "x".repeat(600) } }, { ph: "I", pid: 10, tid: 1, ts: 2, name: "instant" }], metadata: { "trace-config": "{[not an event]}" } });
const RUN = { marks: [{ t: 1000, name: "play-click" }], loaf: [{ start: 1500, dur: 200 }, { start: 2500, dur: 150 }, { start: 4000, dur: 120 }] };

describe("a Chrome trace read as it arrives", () => {
  it("keeps the processes' and threads' names and every slice of 1.5 ms and more, whatever the chunks", () => {
    const whole = traceReader(keepForGpu());
    whole.push(TEXT);
    const kept = whole.events();
    // The 1 ms module and the instant are dropped; the odd name survives its braces and quotes.
    expect(kept).toHaveLength(EVENTS.length - 1 + 1);
    expect(kept.some((e) => e.name === 'odd "{name}" \\ here')).toBe(true);
    expect(kept.some((e) => e.name === "instant" || (e.dur !== undefined && e.dur < 1500))).toBe(false);
    // A slice's arguments are kept when they are short (a label), dropped when they are not.
    expect(kept.find((e) => e.name === "DeviceBase::APICreateRenderPipeline").args).toEqual({ label: PROBE });
    expect(kept.find((e) => e.name.startsWith("odd")).args).toBeUndefined();
    for (const size of [1, 7, 64, 1000]) {
      const pieces = traceReader(keepForGpu());
      for (let i = 0; i < TEXT.length; i += size) pieces.push(TEXT.slice(i, i + size));
      expect(pieces.events()).toEqual(kept);
    }
  });

  it("knows a stream that ended before its events did from one that ended whole", () => {
    const whole = traceReader(keepForGpu());
    whole.push(TEXT);
    expect(whole.whole()).toBe(true);
    const cut = traceReader(keepForGpu());
    cut.push(TEXT.slice(0, TEXT.indexOf("ShaderModuleVk")));
    expect(cut.whole()).toBe(false);
    expect(cut.events().length).toBeGreaterThan(0);
  });

  it("asks Chrome for the categories the GPU thread's tasks and Dawn's calls are in", () => {
    expect(TRACE_CATEGORIES).toEqual(expect.arrayContaining(["toplevel", "gpu", "disabled-by-default-gpu.dawn"]));
  });
});

describe("what held Chrome's GPU thread", () => {
  // As the reader keeps them: the 1 ms module is not among them.
  const KEPT = EVENTS.filter(keepForGpu());

  it("finds the thread's long tasks, with the WebGPU calls inside them and what no call accounts for", () => {
    const tasks = gpuMainTasks(KEPT, { taskMs: 60 });
    expect(tasks).toEqual([{
      ts: us(6000), ms: 96,
      calls: [{ name: "CreateRenderPipeline", label: PROBE, ms: 55 }, { name: "Queue::Submit", label: null, ms: 22 }],
      unnamedMs: 19,
    }]);
    // A lower bar finds the short task too, and never another thread's.
    expect(gpuMainTasks(KEPT, { taskMs: 20 }).map((t) => t.ms)).toEqual([96, 30]);
    expect(gpuMainTasks(KEPT.filter((e) => e.args?.name !== "CrGpuMain"), { taskMs: 20 })).toEqual([]);
  });

  it("sums the thread's WebGPU calls by kind, whatever task they were in, and no other thread's", () => {
    expect(gpuCallTotals(KEPT)).toEqual([{ name: "CreateRenderPipeline", count: 1, ms: 55 }, { name: "Queue::Submit", count: 1, ms: 22 }]);
    expect(gpuCallTotals(KEPT.filter((e) => e.pid !== 10))).toEqual([]);
  });

  it("lays the page's clock on the trace's by the page's longest frames, or says it cannot", () => {
    expect(pageClockOffset(RUN, KEPT)).toBe(OFFSET);
    expect(pageClockOffset({ ...RUN, loaf: RUN.loaf.slice(0, 2) }, KEPT)).toBeNull();
    expect(pageClockOffset(RUN, KEPT.filter((e) => e.pid !== 20))).toBeNull();
  });

  it("lays the clock by a frame's longest script where the run has it, and is not taken in by tasks of other lengths", () => {
    // A frame is several tasks: its longest script is the one a task of the page's thread matches, start and length.
    const run = { marks: RUN.marks, loaf: [
      { start: 1400, dur: 320, scripts: [{ start: 1410, dur: 20 }, { start: 1500, dur: 200 }] },
      { start: 2480, dur: 190, scripts: [{ start: 2500, dur: 150 }] },
      { start: 3990, dur: 140, scripts: [{ start: 4000, dur: 120 }] },
    ] };
    expect(pageClockOffset(run, KEPT)).toBe(OFFSET);
    // The same starts with tasks half as long are other tasks: no offset is taken from them.
    const halved = KEPT.map((e) => (e.pid === 20 && e.ph === "X" ? { ...e, dur: e.dur / 2 } : e));
    expect(pageClockOffset(RUN, halved)).toBeNull();
  });

  it("says where a trace begins and ends, and what its run noted of it", () => {
    // The first slice kept is the page's at 1500 ms; the last to end is another thread's, at 8100 ms.
    expect(traceExtent(KEPT)).toEqual({ from: us(1500), to: us(8100), lost: false, cut: false });
    expect(traceExtent([traceNote({ lost: true, cut: false }), ...KEPT])).toMatchObject({ lost: true, cut: false });
    expect(traceExtent([traceNote({ lost: false, cut: true }), ...KEPT])).toMatchObject({ lost: false, cut: true });
    // The note is one the reader's filter keeps, so a trace read back from its file still holds it.
    expect(keepForGpu()(traceNote({ lost: true, cut: false }))).toBe(true);
    expect(traceExtent([])).toBeNull();
  });

  it("says of each skip whether the trace saw its moment: a skip after the trace's end has no hold to find", () => {
    const skips = [{ t: 6050, skipped: 0.125 }, { t: 7500, skipped: 0.083 }, { t: 40000, skipped: 0.125 }, { t: 900, skipped: 0.083 }];
    expect(skipsWithHolds(RUN, KEPT, skips).map((s) => [s.t, s.seen, s.hold?.ms ?? null])).toEqual([
      [6050, "seen", 96],
      [7500, "seen", null],
      [40000, "outside", null],
      [900, "outside", null],
    ]);
    // With no clock to lay the page on, nothing was looked at.
    expect(skipsWithHolds({ ...RUN, loaf: [] }, KEPT, skips).map((s) => s.seen)).toEqual(["no clock", "no clock", "no clock", "no clock"]);
  });

  it("names the hold a film's skip fell in or just after, and leaves a skip far from any alone", () => {
    const skips = [{ t: 6050, skipped: 0.125 }, { t: 6096 + 140, skipped: 0.083 }, { t: 6096 + 400, skipped: 0.083 }];
    const paired = skipsWithHolds(RUN, KEPT, skips);
    expect(paired.map((s) => [s.t, s.skipped, s.hold?.ms ?? null])).toEqual([[6050, 0.125, 96], [6236, 0.083, 96], [6496, 0.083, null]]);
    // With no clock to lay the page on, no skip is paired.
    expect(skipsWithHolds({ ...RUN, loaf: [] }, KEPT, skips).every((s) => s.hold === null)).toBe(true);
  });
});
