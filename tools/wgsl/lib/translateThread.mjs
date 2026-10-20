// One thread of `translatePool.mjs`: translators of its own, and its share of
// the stages, each translated as `translateStage` translates it.

import { parentPort, workerData } from 'node:worker_threads';
import { startTranslators, translateStage } from './translators.mjs';

const translators = await startTranslators();
parentPort.postMessage(
  workerData.map((entry) => {
    const from = performance.now();
    try {
      return { wgsl: translateStage(translators, entry), ms: performance.now() - from };
    } catch (error) {
      // The translators run in contexts of their own, whose errors are not
      // this context's `Error`s.
      return { error: typeof error?.message === 'string' ? error.message : String(error), ms: performance.now() - from };
    }
  }),
);
