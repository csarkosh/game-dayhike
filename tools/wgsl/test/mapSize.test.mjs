import { describe, expect, it } from 'vitest';
import { MAP_MAX_BYTES } from '../../../client/src/game/wgslFormat.ts';
import { mapSizeProblem } from '../lib/buildMap.mjs';

describe("the map's ceiling", () => {
  it('is 8 MiB of text; a map over it fails the build, naming its size and the ceiling', () => {
    expect(MAP_MAX_BYTES).toBe(8_388_608);
    expect(mapSizeProblem(8_388_608)).toBe(null);
    expect(mapSizeProblem(8_388_609)).toBe(
      "the WGSL map is 8388609 bytes, over its ceiling of 8388608 (MAP_MAX_BYTES): a page reads it in one task and holds its lines for the engine's life. " +
        'A tier whose stages outgrow it is split further, by platform, not given a higher ceiling: see MAP_MAX_BYTES and its reasons in client/src/game/wgslFormat.ts',
    );
    // As the build names a tier's map, with the page's own ceiling.
    expect(mapSizeProblem(8_388_609, MAP_MAX_BYTES, 'the WGSL map of the low tier')).toMatch(/^the WGSL map of the low tier is 8388609 bytes, over its ceiling of 8388608 /);
    expect(mapSizeProblem(8_388_608, MAP_MAX_BYTES, 'the WGSL map of the low tier')).toBe(null);
  });
});
