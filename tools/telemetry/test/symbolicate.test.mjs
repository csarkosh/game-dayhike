import { describe, it, expect } from 'vitest';
import { mapUrl, symbolicate } from '../lib/symbolicate.mjs';

// A map by hand: line 1 of the chunk is src/a.ts line 1; line 2 is line 2,
// and from column 4 on it is src/b.ts line 3 column 2, named `boom`.
const MAP = {
  version: 3,
  sources: ['src/a.ts', 'src/b.ts'],
  names: ['boom'],
  mappings: 'AAAA;AACA,ICCEA',
};

describe('symbolicate', () => {
  it('rewrites the frames a map knows and leaves the rest', async () => {
    const stack = [
      'Error: boom',
      '    at run (https://games.csarko.sh/dayhike/assets/index-CJQw8Dxw.js:2:5)',
      '    at https://games.csarko.sh/dayhike/assets/index-CJQw8Dxw.js:1:1',
      '    at https://games.csarko.sh/dayhike/assets/vendor-xyz.js:9:9',
      '    at native',
    ].join('\n');
    const asked = [];
    const out = await symbolicate(stack, async (file) => {
      asked.push(file);
      return file === 'index-CJQw8Dxw.js' ? MAP : null;
    });
    expect(out.split('\n')).toEqual([
      'Error: boom',
      '    at run (src/b.ts:3:3 (boom) ← index-CJQw8Dxw.js:2:5)',
      '    at src/a.ts:1:1 ← index-CJQw8Dxw.js:1:1',
      '    at https://games.csarko.sh/dayhike/assets/vendor-xyz.js:9:9',
      '    at native',
    ]);
    // Each map is fetched once.
    expect(asked).toEqual(['index-CJQw8Dxw.js', 'vendor-xyz.js']);
  });

  it('names the map where the deploy stored it', () => {
    expect(mapUrl('https://storage.googleapis.com/fps-csarko-downloads', '9557492d', 'index-CJQw8Dxw.js')).toBe(
      'https://storage.googleapis.com/fps-csarko-downloads/sourcemaps/9557492d/assets/index-CJQw8Dxw.js.map',
    );
  });
});
