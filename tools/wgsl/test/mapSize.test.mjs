import { describe, expect, it } from 'vitest';
import { MAP_MAX_BYTES } from '../../../client/src/game/wgslFormat.ts';
import { HEADROOM_WARN, headroomWarning, mapHeadroom, mapSizeProblem } from '../lib/buildMap.mjs';

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

describe("the map's headroom", () => {
  it('is the bytes left under the ceiling and the share used, to a tenth of a percent', () => {
    expect(mapHeadroom(9_815_440, MAP_MAX_BYTES)).toEqual({ left: 670_320, used: 93.6 });
    expect(mapHeadroom(5_242_880, MAP_MAX_BYTES)).toEqual({ left: 5_242_880, used: 50 });
    expect(mapHeadroom(MAP_MAX_BYTES, MAP_MAX_BYTES)).toEqual({ left: 0, used: 100 });
  });

  it('warns from 90 % of the ceiling up to the ceiling itself, and not over it (that is a refusal)', () => {
    expect(HEADROOM_WARN).toBe(0.9);
    expect(headroomWarning(9_437_183, MAP_MAX_BYTES, 'the WGSL map of the high tier')).toBe(null);
    expect(headroomWarning(9_437_184, MAP_MAX_BYTES, 'the WGSL map of the high tier')).toBe(
      'the WGSL map of the high tier is at 90 % of its ceiling of 10485760 bytes, 1048576 bytes left: the next recording merged may pass it',
    );
    expect(headroomWarning(9_815_440, MAP_MAX_BYTES, 'the WGSL map of the high tier')).toMatch(/^the WGSL map of the high tier is at 93\.6 % of its ceiling/);
    expect(headroomWarning(MAP_MAX_BYTES, MAP_MAX_BYTES)).toMatch(/^the WGSL map is at 100 % of its ceiling/);
    expect(headroomWarning(MAP_MAX_BYTES + 1, MAP_MAX_BYTES)).toBe(null);
  });
});
