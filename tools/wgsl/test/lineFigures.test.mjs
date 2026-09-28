import { describe, expect, it } from 'vitest';
import { lineFigures } from '../lib/buildMap.mjs';

describe('how much of the map is repeated lines', () => {
  it('counts every line, the distinct ones and their bytes each once with its newline, and the same with runs of digits as #', () => {
    const figures = lineFigures(['var x_12 : f32;\nvar x_13 : f32;\nreturn;', 'var x_12 : f32;\nvar x_99 : i32;\nreturn;']);
    expect(figures).toEqual({
      lines: 6,
      distinct: 4,
      distinctBytes: 56,
      masked: { lines: 6, distinct: 3, distinctBytes: 36 },
    });
  });

  it('splits at every newline, so a text that ends in one has an empty last line', () => {
    expect(lineFigures(['a\n'])).toEqual({ lines: 2, distinct: 2, distinctBytes: 3, masked: { lines: 2, distinct: 2, distinctBytes: 3 } });
    expect(lineFigures([])).toEqual({ lines: 0, distinct: 0, distinctBytes: 0, masked: { lines: 0, distinct: 0, distinctBytes: 0 } });
  });
});
