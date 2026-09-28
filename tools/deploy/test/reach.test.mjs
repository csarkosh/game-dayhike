import { describe, it, expect } from 'vitest';
import { reach } from '../lib/reach.mjs';

describe('reach', () => {
  it('answers a fetch that throws as a response that failed, its status naming the error, so the checks after it still run', async () => {
    const failed = await reach('https://example.test/x.js', undefined, async () => {
      throw new TypeError('fetch failed');
    });
    expect(failed.status).toBe('no answer (fetch failed)');
    expect(failed.headers.get('cache-control')).toBe(null);
    expect([await failed.text(), (await failed.arrayBuffer()).byteLength, await failed.json()]).toEqual(['', 0, null]);
  });

  it('hands on the response of a fetch that answers', async () => {
    const answered = new Response('ok', { status: 200 });
    expect(await reach('https://example.test/x.js', { method: 'HEAD' }, async () => answered)).toBe(answered);
  });
});
