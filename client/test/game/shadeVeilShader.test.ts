import { describe, expect, it } from "vitest";
import gradeFragment from "../../src/game/shaders/grade.fragment.fx?raw";
import veilFragment from "../../src/game/shaders/shadeVeil.fragment.fx?raw";
import { GRADE_SHADE_BLOCK, GRADE_STARE_BLOCK, VEIL_GAMMA } from "../../src/game/shadeVeilParams.js";

/** The text from the block's first line to the end of its last, which must both be there, in order. */
function block(text: string, [first, last]: readonly [string, string]): string {
  const a = text.indexOf(first);
  const b = a < 0 ? -1 : text.indexOf(last, a);
  if (a < 0 || b < 0) throw new Error(`block not found: ${first.trim()}`);
  return text.slice(a, b + last.length);
}

describe("shadeVeil.fragment.fx stays in lockstep with grade.fragment.fx", () => {
  it("carries the grade's shade block line for line", () => {
    expect(block(veilFragment, GRADE_SHADE_BLOCK)).toBe(block(gradeFragment, GRADE_SHADE_BLOCK));
  });
  it("carries the grade's stare block line for line", () => {
    expect(block(veilFragment, GRADE_STARE_BLOCK)).toBe(block(gradeFragment, GRADE_STARE_BLOCK));
  });
  it("carries the shade noise helpers the block calls, as the grade has them", () => {
    for (const fn of ["float shadeHash(vec2 p)", "float shadeNoise(vec2 p)"]) {
      const from = gradeFragment.indexOf(fn);
      const helper = gradeFragment.slice(from, gradeFragment.indexOf("}\n", from) + 2);
      expect(veilFragment).toContain(helper);
    }
  });
  it("writes the factor through the display's gamma, so a darkening matches the grade's linear one", () => {
    expect(VEIL_GAMMA).toBeCloseTo(1 / 2.2, 15);
    expect(veilFragment).toContain(`gl_FragColor = vec4(pow(c, vec3(${VEIL_GAMMA})), 1.0);`);
  });
  it("declares the grade's names for what it binds", () => {
    for (const line of ["uniform sampler2D shadeSampler;", "uniform vec4 shadeShape;", "uniform float shadeMonster;", "uniform vec4 stareShade;", "varying vec2 vUV;"]) {
      expect(veilFragment).toContain(line);
    }
  });
});
