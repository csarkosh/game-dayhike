import { describe, expect, it } from "vitest";
import { createShaderMaterial, getShaderUniform } from "@babylonjs/lite";
import { shaderUniformDecls, shaderUniformWriter } from "../../../src/game/lite/shaderUniforms.js";

const record = (): { one: number[]; two: number[]; three: number[]; four: number[] } => ({ one: [1], two: [2, 3], three: [4, 5, 6], four: [7, 8, 9, 10] });
const material = (r: Record<string, number[]>): ReturnType<typeof createShaderMaterial> =>
  createShaderMaterial({ vertexSource: "v", fragmentSource: "f", attributes: ["position"], uniforms: shaderUniformDecls(r) });

describe("a shader material's uniforms from a record by name", () => {
  it("declares a uniform a name, typed by how many floats it has, at the record's values", () => {
    const r = record();
    const decls = shaderUniformDecls(r);
    expect(decls).toEqual([
      { name: "one", type: "f32", defaultValue: [1] }, { name: "two", type: "vec2<f32>", defaultValue: [2, 3] },
      { name: "three", type: "vec3<f32>", defaultValue: [4, 5, 6] }, { name: "four", type: "vec4<f32>", defaultValue: [7, 8, 9, 10] },
    ]);
    // A copy: the record is filled in place afterwards.
    expect(decls[1]?.defaultValue).not.toBe(r.two);
    expect(() => shaderUniformDecls({ none: [] })).toThrow(/no WGSL type: none/);
    expect(() => shaderUniformDecls({ five: [1, 2, 3, 4, 5] })).toThrow(/no WGSL type: five/);
  });

  it("writes nothing while the record stands as it was declared, then only the values that have moved", () => {
    const r = record();
    const m = material(r);
    const write = shaderUniformWriter(m, r);
    expect(write()).toBe(false);
    r.one[0] = 1.5;
    r.three[2] = -6;
    expect(write()).toBe(true);
    expect(getShaderUniform(m, "one")).toBe(1.5);
    expect([...(getShaderUniform(m, "three") as Float32Array)]).toEqual([4, 5, -6]);
    expect([...(getShaderUniform(m, "two") as Float32Array)]).toEqual([2, 3]);
    // The same values again: nothing goes.
    expect(write()).toBe(false);
    r.four[0] = 0;
    expect(write()).toBe(true);
    expect([...(getShaderUniform(m, "four") as Float32Array)]).toEqual([0, 8, 9, 10]);
    expect(write()).toBe(false);
  });

  it("counts a value as moved only where the GPU's float of it has", () => {
    const r = { level: [0.1] };
    const write = shaderUniformWriter(material(r), r);
    // A double that rounds to the same 32-bit float is the same uniform.
    r.level[0] = 0.1 + 1e-12;
    expect(write()).toBe(false);
    r.level[0] = 0.1 + 1e-6;
    expect(write()).toBe(true);
  });
});
