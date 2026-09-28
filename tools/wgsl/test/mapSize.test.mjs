import { describe, expect, it } from 'vitest';
import { MAP_MAX_BYTES } from '../../../client/src/game/wgslFormat.ts';
import { mapSizeProblem } from '../lib/buildMap.mjs';

describe("the map's ceiling", () => {
  it('is 32 MiB of text; a map over it fails the build, naming its size and the ceiling', () => {
    expect(MAP_MAX_BYTES).toBe(33_554_432);
    expect(mapSizeProblem(33_554_432)).toBe(null);
    expect(mapSizeProblem(33_554_433)).toBe(
      'the WGSL map is 33554433 bytes, over its ceiling of 33554432 (MAP_MAX_BYTES): a page would hold it whole for the engine\'s life',
    );
  });
});
