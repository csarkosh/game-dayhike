import { describe, expect, it } from 'vitest';
import { MAP_MAX_BYTES } from '../../../client/src/game/wgslFormat.ts';
import { mapSizeProblem } from '../lib/buildMap.mjs';

describe("the map's ceiling", () => {
  it('is 10 MiB of text; a map over it fails the build, naming its size and the ceiling', () => {
    expect(MAP_MAX_BYTES).toBe(10_485_760);
    expect(mapSizeProblem(10_485_760)).toBe(null);
    expect(mapSizeProblem(10_485_761)).toBe(
      "the WGSL map is 10485761 bytes, over its ceiling of 10485760 (MAP_MAX_BYTES): a page reads it in one task and holds its lines for the engine's life. " +
        'A tier whose stages outgrow it is split further, by platform, not given a higher ceiling: see MAP_MAX_BYTES and its reasons in client/src/game/wgslFormat.ts',
    );
    // As the build names a tier's map, with the page's own ceiling.
    expect(mapSizeProblem(10_485_761, MAP_MAX_BYTES, 'the WGSL map of the low tier')).toMatch(/^the WGSL map of the low tier is 10485761 bytes, over its ceiling of 10485760 /);
    expect(mapSizeProblem(10_485_760, MAP_MAX_BYTES, 'the WGSL map of the low tier')).toBe(null);
  });
});
