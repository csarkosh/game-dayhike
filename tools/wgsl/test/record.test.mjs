import { describe, expect, it } from 'vitest';
import { runJobs, withLimit } from '../record.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a page within its limit', () => {
  it('gives the work its result when it ends in time', async () => {
    await expect(withLimit(Promise.resolve('recorded'), 1, 'the page')).resolves.toBe('recorded');
  });

  it('fails the page, naming the limit, when the work hangs past it', async () => {
    const hang = new Promise(() => {});
    await expect(withLimit(hang, 0.05, 'the page')).rejects.toThrow('the page took over 0.05 s');
  });

  it('passes the work\'s own failure through', async () => {
    await expect(withLimit(Promise.reject(new Error('Chrome closed the connection')), 1, 'the page')).rejects.toThrow('Chrome closed the connection');
  });
});

describe('pages run at once', () => {
  it('runs at most `at` jobs at a time and keeps each result at its job\'s index', async () => {
    let running = 0;
    let most = 0;
    const results = await runJobs([30, 10, 20, 5], 2, async (ms, i) => {
      running += 1;
      most = Math.max(most, running);
      await sleep(ms);
      running -= 1;
      return `job ${i}`;
    });
    expect(results).toEqual(['job 0', 'job 1', 'job 2', 'job 3']);
    expect(most).toBe(2);
  });

  it('turns a job that throws into its problem and runs the rest', async () => {
    const results = await runJobs(['a', 'b', 'c'], 3, async (name) => {
      if (name === 'b') throw new Error('Chrome closed the connection');
      return name;
    });
    expect(results).toEqual(['a', { problem: 'Chrome closed the connection' }, 'c']);
  });

  it('runs one at a time with fewer jobs than workers, or none', async () => {
    expect(await runJobs(['only'], 4, async (name) => name)).toEqual(['only']);
    expect(await runJobs([], 4, async () => 'never')).toEqual([]);
  });
});
