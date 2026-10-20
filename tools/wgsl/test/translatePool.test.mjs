import { beforeAll, describe, expect, it } from 'vitest';
import { timeLimit } from '../../../client/test/helpers/timeLimit.ts';
import { readCorpusDir } from '../lib/corpus.mjs';
import { NODE_CORPUS_DIR } from '../lib/files.mjs';
import { loadShared } from '../lib/shared.mjs';
import { translateOnThreads } from '../lib/translatePool.mjs';
import { startTranslators, translateStage } from '../lib/translators.mjs';

/** A stage glslang refuses. */
const BROKEN = { stage: 'fragment', flag: false, glsl: '#version 450\nvoid main( { this is not GLSL' };

describe('the corpus translated on threads', () => {
  let stages;
  let alone;
  beforeAll(async () => {
    stages = [...readCorpusDir(NODE_CORPUS_DIR, await loadShared()).stages, BROKEN];
    const translators = await startTranslators();
    alone = stages.map((entry) => {
      try {
        return { wgsl: translateStage(translators, entry) };
      } catch (error) {
        return { error: typeof error?.message === 'string' ? error.message : String(error) };
      }
    });
  }, timeLimit(60_000));

  it('makes each stage the WGSL one thread makes of it, on any number of threads, and the same refusal', async () => {
    for (const threads of [1, 3, 64]) {
      const results = await translateOnThreads(stages, threads);
      expect(results.size).toBe(stages.length);
      stages.forEach((entry, i) => {
        const { wgsl, error, ms } = results.get(entry);
        expect({ wgsl, error }, `stage ${i} on ${threads} threads`).toEqual(alone[i]);
        expect(ms).toBeGreaterThanOrEqual(0);
      });
    }
    expect(alone.at(-1).error).toEqual(expect.any(String));
    expect(alone.filter((r) => r.wgsl !== undefined)).toHaveLength(stages.length - 1);
  }, timeLimit(60_000));
});
