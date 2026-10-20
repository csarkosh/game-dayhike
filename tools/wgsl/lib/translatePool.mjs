// The corpus's stages translated on worker threads, each thread with
// translators of its own (`translators.mjs`, `translateThread.mjs`): one
// thread took two minutes over the 1115 stages of 2026-10-19, most of a
// deploy's time. Every stage is translated whole on one thread by the very
// files the page ships, as `translateStage` translates it, so a stage's WGSL
// is the same whichever thread made it (`translatePool.test.mjs`); the build
// reads every map back against these translations either way.

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

/** The threads a build translates on unless told: the machine's cores less one, at most eight. */
export function defaultThreads() {
  return Math.max(1, Math.min(8, availableParallelism() - 1));
}

/**
 * Each of `stages` translated on `threads` threads, every `threads`-th stage
 * to a thread: a Map from each stage to `{ wgsl, ms }`, or to `{ error, ms }`
 * where a translator threw, `error` its message as `buildMap` keeps it.
 */
export async function translateOnThreads(stages, threads = defaultThreads()) {
  const count = Math.max(1, Math.min(threads, stages.length));
  const shares = Array.from({ length: count }, (_, k) => stages.filter((_, i) => i % count === k));
  const done = await Promise.all(shares.map(translateShare));
  const results = new Map();
  shares.forEach((share, k) => share.forEach((stage, i) => results.set(stage, done[k][i])));
  return results;
}

function translateShare(share) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./translateThread.mjs', import.meta.url), {
      workerData: share.map(({ stage, flag, glsl }) => ({ stage, flag, glsl })),
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => code === 0 || reject(new Error(`a translation thread exited with ${code}`)));
  });
}
