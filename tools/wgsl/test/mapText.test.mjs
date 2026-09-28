import { describe, expect, it } from 'vitest';
import { asciiProblem } from '../lib/buildMap.mjs';

describe("the map's text", () => {
  it('passes ASCII, and names the first character outside it and how many there are', () => {
    expect(asciiProblem('{"entries":{"aa":"fn main() {}\\n"}}')).toBe(null);
    expect(asciiProblem('fn main() {} // é and €')).toBe('the WGSL map is not ASCII: 2 characters outside it, the first at character 16');
  });
});
