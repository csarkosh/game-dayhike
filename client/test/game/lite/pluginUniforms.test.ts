import { describe, expect, it } from "vitest";
import { uniformFields, wgslType, writeUniforms } from "@csarkosh/engine/game/lite/pluginUniforms";

describe("a material plugin's uniforms from a record by name", () => {
  it("declares one field a name, in the record's order, its type by how many floats it has", () => {
    expect(uniformFields({ a: [1], b: [1, 2], c: [1, 2, 3], d: [1, 2, 3, 4] })).toEqual([
      { name: "a", type: "f32" },
      { name: "b", type: "vec2<f32>" },
      { name: "c", type: "vec3<f32>" },
      { name: "d", type: "vec4<f32>" },
    ]);
  });

  it("says which stages read its fields where it is told, and leaves it unsaid where it is not", () => {
    expect(uniformFields({ a: [1], b: [1, 2] }, "vertex-fragment")).toEqual([
      { name: "a", type: "f32", visibility: "vertex-fragment" },
      { name: "b", type: "vec2<f32>", visibility: "vertex-fragment" },
    ]);
    expect(Object.keys(uniformFields({ a: [1] })[0] as object)).toEqual(["name", "type"]);
  });

  it("has no type for a value of no floats or of more than four", () => {
    expect(() => wgslType(0)).toThrow(/0 components/);
    expect(() => wgslType(5)).toThrow(/5 components/);
  });

  it("writes each value at its field's byte offset and nothing else", () => {
    const data = new Float32Array(12).fill(-1);
    writeUniforms(data, new Map([["b", 32], ["a", 4]]), { a: [7], b: [1, 2, 3] });
    expect([...data]).toEqual([-1, 7, -1, -1, -1, -1, -1, -1, 1, 2, 3, -1]);
  });

  it("throws on a value no field was laid out for, naming it", () => {
    expect(() => writeUniforms(new Float32Array(4), new Map([["a", 0]]), { a: [1], stray: [2] })).toThrow(/no uniform stray/);
  });
});
