#!/usr/bin/env node
// A round of experiments spread over several rigs: one harness run per (experiment, tier) job, one
// job at a time on each forwarded port, each port taking the next job as it comes free. A port whose
// tunnel is down waits for it; a run that fails (a tunnel dropped under it, a page that never came
// ready) goes back on the queue, its partial rows kept aside, up to --retries times, and any port may
// take it. Each run's output goes to runs/<name>-<tier>.log beside its rows.
//
//   node tools/frame-budget/rig/chain.mjs --queue <file.json> --ports 9333,9334[,…] [--retries 1] [--dry-run]
//
// The queue file:
//
//   { "base": "<url of A>", "machine": "g4dn.xlarge",
//     "jobs": [ { "name": "cull", "against": "<url of B>", "views": ["trailhead", "forest", "meadow", "crest"] },
//               { "name": "night", "tier": "medium", "against": "<url>", "views": "forest-night", "shot": true } ] }
//
// A job runs on both tiers unless it names `tier` (or `tiers`); `views`, `pairs`, `settle`, `shot`,
// `base` and `machine` pass through to measure.mjs. Each port is a rig's Chrome, forwarded as the
// README's rig day says (`rig/forward.sh <instance id> <port>`, one a rig, left running).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { capMinutes, expandJobs, parseChainArgs } from "../lib/chain.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MEASURE = join(HERE, "..", "measure.mjs");
const RUNS = join(HERE, "..", "runs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().slice(11, 19);
const say = (port, text) => process.stdout.write(`${now()} [${port}] ${text}\n`);

/** True once the Chrome behind `port` answers; false after `maxS` seconds without one. */
async function tunnelUp(port, maxS) {
  const end = Date.now() + maxS * 1000;
  for (;;) {
    const ok = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(4000) })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return true;
    if (Date.now() > end) return false;
    await sleep(10_000);
  }
}

/** One harness run on `port`, bounded by the job's cap; resolves to its exit code (null if killed). */
function runJob(job, port) {
  const out = join(RUNS, `${job.id}.jsonl`);
  if (existsSync(out)) renameSync(out, join(RUNS, `${job.id}.partial-${Date.now()}.jsonl`));
  const log = openSync(join(RUNS, `${job.id}.log`), "a");
  const args = [MEASURE, ...job.args, "--remote", String(port), "--out", out];
  const child = spawn(process.execPath, args, { stdio: ["ignore", log, log] });
  const cap = capMinutes(job);
  say(port, `${job.id} starts (attempt ${job.attempts}, capped at ${cap} min)`);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      say(port, `${job.id} over its ${cap} min cap: killed`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, cap * 60_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function main() {
  const options = parseChainArgs(process.argv.slice(2));
  const queue = JSON.parse(readFileSync(options.queue, "utf8"));
  const jobs = expandJobs(queue);
  if (options.dryRun) {
    for (const j of jobs) process.stdout.write(`${j.id}  cap ${capMinutes(j)} min  ${j.args.join(" ")}\n`);
    const work = jobs.reduce((s, j) => s + capMinutes(j) - 10, 0);
    process.stdout.write(`${jobs.length} job(s) over ${options.ports.length} port(s): about ${Math.ceil(work / options.ports.length)} min at the caps' pace\n`);
    return;
  }
  mkdirSync(RUNS, { recursive: true });
  const pending = [...jobs];
  const done = [];
  const failed = [];
  const started = Date.now();
  const worker = async (port) => {
    for (;;) {
      const job = pending.shift();
      if (job === undefined) return;
      if (!(await tunnelUp(port, 30 * 60))) {
        say(port, `no Chrome answered for 30 minutes: this port stops; ${job.id} goes back on the queue`);
        pending.unshift(job);
        return;
      }
      job.attempts += 1;
      const code = await runJob(job, port);
      if (code === 0) {
        say(port, `${job.id} done`);
        done.push(job);
      } else if (job.attempts <= options.retries) {
        say(port, `${job.id} exited ${code}: back on the queue (attempt ${job.attempts} of ${options.retries + 1})`);
        pending.unshift(job);
        await sleep(15_000);
      } else {
        say(port, `${job.id} exited ${code} on its last attempt: given up`);
        failed.push(job);
      }
    }
  };
  await Promise.all(options.ports.map((port) => worker(port)));
  const mins = Math.round((Date.now() - started) / 60_000);
  process.stdout.write(`\n${done.length} done, ${failed.length} failed, ${pending.length} never run, in ${mins} min on ${options.ports.length} port(s)\n`);
  for (const j of failed) process.stdout.write(`  failed: ${j.id} (see runs/${j.id}.log)\n`);
  for (const j of pending) process.stdout.write(`  never run: ${j.id}\n`);
  process.exitCode = failed.length + pending.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
