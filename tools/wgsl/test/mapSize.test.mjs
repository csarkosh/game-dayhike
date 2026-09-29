import { describe, expect, it } from 'vitest';
import { MAP_MAX_BYTES } from '../../../client/src/game/wgslFormat.ts';
import { mapSizeProblem } from '../lib/buildMap.mjs';

describe("the map's ceiling", () => {
  it('is 8 MiB of text; a map over it fails the build, naming its size and the ceiling', () => {
    expect(MAP_MAX_BYTES).toBe(8_388_608);
    expect(mapSizeProblem(8_388_608)).toBe(null);
    expect(mapSizeProblem(8_388_609)).toBe(
      "the WGSL map is 8388609 bytes, over its ceiling of 8388608 (MAP_MAX_BYTES): a page reads it in one task and holds its lines for the engine's life",
    );
  });
});
