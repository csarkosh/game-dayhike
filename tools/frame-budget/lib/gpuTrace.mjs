// What held Chrome's GPU thread during a traced run. Chrome's GPU process decodes a page's WebGPU
// commands and presents a film's frames on one thread (`CrGpuMain`): a batch of the game's commands
// that holds it about 85 ms drops two of the intro film's frames, and one near 100 ms and more has
// dropped three (a Pixel 9, 2026-11-12). The page's own long frames do not do it: a page thread
// held 0.3 s on a blank page dropped none. So a hold is read from Chrome's own trace, which the
// timeline harness records when asked (`--trace`): this module reads that trace as it arrives,
// keeping only what the report needs, and finds the thread's long tasks and the WebGPU calls
// inside them. Pure: no file, no socket.

/** The trace categories the report reads: the threads' tasks, the GPU process's own, Dawn's calls. */
export const TRACE_CATEGORIES = ["toplevel", "gpu", "viz", "media", "gpu.dawn", "disabled-by-default-gpu.dawn", "disabled-by-default-gpu.service"];

/** The GPU process's main thread, as Chrome names it. */
const GPU_MAIN = "CrGpuMain";
/** A page's main thread. */
const PAGE_MAIN = "CrRendererMain";
/** A thread's task, as the `toplevel` category names each. */
const TASK = "ThreadControllerImpl::RunTask";
/** The WebGPU calls a hold is made of, and the name the report gives each. */
const CALLS = [
  [/APICreateRenderPipeline$/, "CreateRenderPipeline"],
  [/APICreateComputePipeline$/, "CreateComputePipeline"],
  [/APICreateShaderModule$/, "CreateShaderModule"],
  [/^Queue::Submit$/, "Queue::Submit"],
];
/** A slice's arguments are kept when their JSON is this short: a label, not a payload. */
const ARGS_MAX = 300;

/**
 * Reads a Chrome trace's JSON text in chunks, as it arrives (`{"traceEvents":[{…},{…}],…}`, hundreds
 * of megabytes whole), and keeps the events `keep(event)` says to, each as `{ ph, pid, tid, ts, dur,
 * name, cat, args }` with `args` dropped where it is long. `push(text)` feeds a chunk, cut anywhere;
 * `events()` is what was kept so far, and `whole()` whether the events' list was read to its end (a
 * stream cut short never closes it). Text that is not an event (the trace's own metadata) is passed over.
 */
export function traceReader(keep) {
  const kept = [];
  let depth = 0, inString = false, escaped = false, inArray = false, closed = false, buf = "";
  const take = (text) => {
    let e;
    try {
      e = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof e.ph !== "string" || !keep(e)) return;
    const args = e.args !== undefined && JSON.stringify(e.args).length <= ARGS_MAX ? e.args : undefined;
    kept.push({ ph: e.ph, pid: e.pid, tid: e.tid, ts: e.ts, ...(e.dur === undefined ? {} : { dur: e.dur }), name: e.name, cat: e.cat, ...(args === undefined ? {} : { args }) });
  };
  return {
    push(text) {
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (!inArray) {
          if (c === "[" && !closed) inArray = true;
          continue;
        }
        if (depth > 0) buf += c;
        if (inString) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') inString = false;
          continue;
        }
        if (c === '"') inString = true;
        else if (c === "{") {
          if (depth === 0) buf = "{";
          depth++;
        } else if (c === "}") {
          depth--;
          if (depth === 0) {
            take(buf);
            buf = "";
          }
        } else if (c === "]" && depth === 0) {
          inArray = false;
          closed = true;
        }
      }
    },
    events: () => kept,
    whole: () => closed,
  };
}

/** The name of the note a run leaves at the head of its kept trace (`traceNote`). */
const NOTE = "dayhike_trace";

/** What the report needs of a trace: the processes' and threads' names, the run's note, and every complete slice of `minMs` or more. */
export function keepForGpu(minMs = 1.5) {
  return (e) => (e.ph === "M" && (e.name === "process_name" || e.name === "thread_name" || e.name === NOTE)) || (e.ph === "X" && e.dur >= minMs * 1000);
}

/**
 * What a run notes of the trace it kept, as an event at its head: `lost`, Chrome said it dropped
 * part of the trace (its buffer filled), and `cut`, the stream ended before the events did. Either
 * way a stretch of the run may be missing from the trace with nothing to show where.
 */
export function traceNote({ lost, cut }) {
  return { ph: "M", pid: 0, tid: 0, name: NOTE, args: { lost: lost === true, cut: cut === true } };
}

/**
 * Where a kept trace begins and ends, in its own microseconds (`from` the first slice's start, `to`
 * the last slice's end), with the run's note of it (`lost`, `cut`; false where it left none). Null
 * for a trace with no slice.
 */
export function traceExtent(events) {
  let from = Infinity, to = -Infinity;
  for (const e of events) {
    if (e.ph !== "X") continue;
    from = Math.min(from, e.ts);
    to = Math.max(to, e.ts + e.dur);
  }
  if (from === Infinity) return null;
  const note = events.find((e) => e.ph === "M" && e.name === NOTE)?.args ?? {};
  return { from, to, lost: note.lost === true, cut: note.cut === true };
}

/** The `pid:tid` of every thread named `name`. */
function threadsNamed(events, name) {
  return events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === name).map((e) => `${e.pid}:${e.tid}`);
}

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * The GPU process's main thread's tasks of `taskMs` or more, in order: `{ ts, ms, calls, unnamedMs }`,
 * `ts` the trace's microseconds, `calls` the WebGPU calls inside (`{ name, label, ms }`, longest first:
 * pipelines made synchronously, shader modules, submits) and `unnamedMs` what of the task no call accounts for.
 */
export function gpuMainTasks(events, { taskMs = 60 } = {}) {
  const [thread] = threadsNamed(events, GPU_MAIN);
  if (thread === undefined) return [];
  const mine = events.filter((e) => e.ph === "X" && `${e.pid}:${e.tid}` === thread);
  return mine
    .filter((e) => e.name === TASK && e.dur >= taskMs * 1000)
    .sort((a, b) => a.ts - b.ts)
    .map((task) => {
      const calls = [];
      for (const e of mine) {
        if (e === task || e.ts < task.ts || e.ts + e.dur > task.ts + task.dur) continue;
        const kind = CALLS.find(([re]) => re.test(e.name));
        if (kind !== undefined) calls.push({ name: kind[1], label: e.args?.label ?? null, ms: round1(e.dur / 1000) });
      }
      calls.sort((a, b) => b.ms - a.ms);
      const ms = round1(task.dur / 1000);
      return { ts: task.ts, ms, calls, unnamedMs: round1(Math.max(0, ms - calls.reduce((n, c) => n + c.ms, 0))) };
    });
}

/** Every WebGPU call the GPU thread ran that the trace kept (those of 1.5 ms and more, with `keepForGpu`),
 * summed by kind, whatever task it was in: `{ name, count, ms }`, the most first. */
export function gpuCallTotals(events) {
  const [thread] = threadsNamed(events, GPU_MAIN);
  if (thread === undefined) return [];
  const by = new Map();
  for (const e of events) {
    if (e.ph !== "X" || `${e.pid}:${e.tid}` !== thread) continue;
    const kind = CALLS.find(([re]) => re.test(e.name));
    if (kind === undefined) continue;
    const sum = by.get(kind[1]) ?? { name: kind[1], count: 0, ms: 0 };
    sum.count++;
    sum.ms += e.dur / 1000;
    by.set(kind[1], sum);
  }
  return [...by.values()].map((sum) => ({ ...sum, ms: round1(sum.ms) })).sort((a, b) => b.ms - a.ms);
}

/**
 * The microseconds to add to a page time (ms × 1000) to get the trace's. The run's longest frames
 * (the page's loading among them: a trace is short) are laid on the long tasks of a page's main thread: each frame by its longest script
 * (a frame is several tasks; a script is one), or by its own start and length where the run names
 * no scripts. An offset is taken only where three frames or more find a task that starts where it
 * says (within 15 ms) and lasts as long (within 15 ms or 15 %). Null where none does: the trace
 * began too late, or holds no page.
 */
export function pageClockOffset(run, events) {
  const anchors = (run.loaf ?? [])
    .filter((l) => l.dur >= 100)
    .map((l) => [...(l.scripts ?? [])].sort((a, b) => b.dur - a.dur)[0] ?? { start: l.start, dur: l.dur })
    .filter((a) => a.dur >= 80)
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 16);
  const same = (taskMs, ms) => Math.abs(taskMs - ms) <= Math.max(15, ms * 0.15);
  let best = null;
  for (const thread of threadsNamed(events, PAGE_MAIN)) {
    const tasks = events.filter((e) => e.ph === "X" && `${e.pid}:${e.tid}` === thread && e.name === TASK && e.dur >= 60_000);
    for (const task of tasks) {
      for (const anchor of anchors.slice(0, 6)) {
        if (!same(task.dur / 1000, anchor.dur)) continue;
        const offset = task.ts - anchor.start * 1000;
        const score = anchors.filter((a) => tasks.some((t) => Math.abs(t.ts - (a.start * 1000 + offset)) < 15_000 && same(t.dur / 1000, a.dur))).length;
        if (best === null || score > best.score) best = { offset, score };
      }
    }
  }
  return best !== null && best.score >= 3 ? best.offset : null;
}

/** A skip is laid to a hold it fell in, or this long after its end (ms): a frame dropped is first missed a little after. */
const AFTER_HOLD_MS = 150;
/** The shortest task a skip is laid to (ms). */
const HOLD_MS = 40;

/**
 * The film's skips (`pictureSkips`: `{ t, skipped }`, page ms), each with the GPU thread task it fell
 * in or just after as `hold`, or null, and `seen`, whether the trace could have shown one: `"seen"`
 * where the skip's moment is inside the trace (a null hold there is no hold), `"outside"` where the
 * skip came before the trace began or after it ended (a trace is shorter than a run), `"no clock"`
 * where the page's clock could not be laid on the trace. Only a skip seen with no hold had none.
 */
export function skipsWithHolds(run, events, skips) {
  const offset = pageClockOffset(run, events);
  const extent = traceExtent(events);
  const tasks = offset === null ? [] : gpuMainTasks(events, { taskMs: HOLD_MS });
  return skips.map((skip) => {
    if (offset === null || extent === null) return { ...skip, hold: null, seen: "no clock" };
    const at = skip.t * 1000 + offset;
    if (at < extent.from || at > extent.to) return { ...skip, hold: null, seen: "outside" };
    const hold = tasks.filter((task) => at >= task.ts && at <= task.ts + (task.ms + AFTER_HOLD_MS) * 1000).sort((a, b) => b.ms - a.ms)[0] ?? null;
    return { ...skip, hold, seen: "seen" };
  });
}
