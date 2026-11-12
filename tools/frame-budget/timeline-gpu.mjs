#!/usr/bin/env node
// What held Chrome's GPU thread during a traced intro (`timeline.mjs --trace`, `lib/gpuTrace.mjs`):
// that thread decodes the page's WebGPU commands and presents the film's frames, so a batch of the
// game's commands that holds it about 85 ms drops two of the film's frames and one near 100 ms and
// more has dropped three. For each run with its `<label>.trace.jsonl` beside it: every task of the
// thread of --task ms or more (60 by default) with when it ran after Play, the WebGPU calls inside
// (pipelines made synchronously, shader modules, submits) and what no call accounts for; the film's
// skips, each with the hold it fell in; and the thread's WebGPU calls summed by kind.
//
//   node tools/frame-budget/timeline-gpu.mjs <run.json> [<run.json> ...] [--task 60]
//
// Exits 2 with no run named, 0 otherwise: a report, not a verdict.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { filmRate, pictureSkips } from "./lib/film.mjs";
import { gpuCallTotals, gpuMainTasks, pageClockOffset, skipsWithHolds, traceExtent } from "./lib/gpuTrace.mjs";

const args = process.argv.slice(2);
const taskMs = args.includes("--task") ? Number(args[args.indexOf("--task") + 1]) : 60;
const files = args.filter((a) => a.endsWith(".json"));
if (files.length === 0) {
  console.error("usage: timeline-gpu.mjs <run.json> [<run.json> ...] [--task 60]");
  process.exit(2);
}
/** A skip under this is one frame late, not a frame dropped (s). */
const SKIP_MIN_S = 0.06;
for (const file of files) {
  const label = basename(file, ".json");
  const traceFile = file.replace(/\.json$/, ".trace.jsonl");
  if (!existsSync(traceFile)) {
    console.log(`${label}: no trace beside it (run it with --trace)`);
    continue;
  }
  const run = JSON.parse(readFileSync(file, "utf8"));
  const events = readFileSync(traceFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const play = run.marks.find((m) => m.name === "play-click")?.t ?? run.marks.find((m) => m.name === "sprint-on")?.t ?? 0;
  const ready = run.marks.find((m) => m.name === "world-ready")?.t;
  const end = run.marks.find((m) => m.name === "film-end")?.t ?? Infinity;
  const offset = pageClockOffset(run, events);
  const extent = traceExtent(events);
  if (extent === null) {
    console.log(`${label}: its trace holds no slice`);
    continue;
  }
  const tasks = gpuMainTasks(events, { taskMs });
  /** A trace time as seconds after Play, or as seconds into the trace where the page's clock could not be laid on it. */
  const when = (ts) => (offset === null ? `+${((ts - extent.from) / 1e6).toFixed(2)}` : (((ts - offset) / 1000 - play) / 1000).toFixed(2).padStart(6));
  const span = offset === null ? `${((extent.to - extent.from) / 1e6).toFixed(1)} s long` : `from ${when(extent.from).trim()} to ${when(extent.to).trim()} s after Play`;
  console.log(`\n${label}: world ready ${ready === undefined ? "never" : `${((ready - play) / 1000).toFixed(1)} s after Play`}; the trace runs ${span}; ${tasks.length} task${tasks.length === 1 ? "" : "s"} of ${taskMs} ms or more on Chrome's GPU thread${offset === null ? " (the page's clock could not be laid on the trace: times are into the trace)" : ""}`);
  // A trace with a stretch missing shows no hold there: said, so no skip is read as having none.
  if (extent.lost) console.log("  Chrome dropped part of this trace (its buffer filled): a hold may be missing from it");
  if (extent.cut) console.log("  this trace's stream ended before its events did: a hold may be missing from it");
  for (const task of tasks) {
    const calls = task.calls.filter((c) => c.ms >= 2).slice(0, 4).map((c) => `${c.name} ${Math.round(c.ms)} ms${c.label ? ` [${String(c.label).slice(0, 70)}]` : ""}`);
    console.log(`  ${when(task.ts)} s  ${String(Math.round(task.ms)).padStart(4)} ms  ${[...calls, `no call for ${Math.round(task.unnamedMs)} ms`].join("; ")}`);
  }
  const skips = skipsWithHolds(run, events, pictureSkips(run.shown ?? [], { rate: filmRate(run.shown ?? []), min: SKIP_MIN_S }).filter((k) => k.t > play && k.t < end));
  const where = (k) => {
    if (k.seen === "no clock") return " (not looked for: no clock)";
    if (k.seen === "outside") return " (outside the trace)";
    return k.hold === null ? " (no hold of 40 ms near it)" : ` in the ${Math.round(k.hold.ms)} ms hold at ${when(k.hold.ts).trim()} s`;
  };
  const said = skips.map((k) => `${((k.t - play) / 1000).toFixed(2)} s ${k.skipped.toFixed(3)} s${where(k)}`);
  console.log(`  the film's skips: ${said.join("; ") || "none"}`);
  console.log(`  the thread's WebGPU calls of 1.5 ms and more in the trace: ${gpuCallTotals(events).map((c) => `${c.name} ×${c.count} ${Math.round(c.ms)} ms`).join(", ") || "none"}`);
}
