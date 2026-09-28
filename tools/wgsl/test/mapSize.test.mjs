import { describe, expect, it } from 'vitest';
import { MAP_MAX_BYTES } from '../../../client/src/game/wgslFormat.ts';
import { mapSizeProblem } from '../lib/buildMap.mjs';

describe("the map's ceiling", () => {
  it('is 16 MB of text; a map over it fails the build, naming its size and the ceiling', () => {
    expect(MAP_MAX_BYTES).toBe(16_777_216);
    expect(mapSizeProblem(16_777_216)).toBe(null);
    expect(mapSizeProblem(16_777_217)).toBe(
      'the WGSL map is 16777217 bytes, over its ceiling of 16777216 (MAP_MAX_BYTES): a page would hold it whole for the engine\'s life',
    );
  });
});
