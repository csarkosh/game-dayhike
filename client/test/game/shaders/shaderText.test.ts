import { describe, expect, it } from "vitest";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";

describe("the text of a shader file", () => {
  it("is the file's without its one final newline", () => {
    expect(wgsl("fn f()->f32{return 1.0;}\n")).toBe("fn f()->f32{return 1.0;}");
    expect(wgsl("let a=1.0;\n\n")).toBe("let a=1.0;\n");
    expect(wgsl("let a=1.0;")).toBe("let a=1.0;");
    expect(wgsl("")).toBe("");
  });
});

describe("a shader file's slots", () => {
  it("are replaced by the value of their name, every one of them", () => {
    expect(fill("a=${x};b=${y};c=${x};", { x: "1.0", y: "vec2<f32>(0.0)" })).toBe("a=1.0;b=vec2<f32>(0.0);c=1.0;");
    expect(fill("no slots", {})).toBe("no slots");
  });

  it("take a number as a template literal writes it", () => {
    expect(fill("array<vec4<u32>,${n}>;let h=${h}.0;", { n: 18, h: 128 / 2 })).toBe("array<vec4<u32>,18>;let h=64.0;");
    expect(fill("a=${x};", { x: 1e-7 })).toBe("a=1e-7;");
  });

  it("take a value that is filled text itself", () => {
    const inner = fill("let k=${n};", { n: "2.0" });
    expect(fill("{${inner}}", { inner })).toBe("{let k=2.0;}");
  });

  it("are not changed by a value with a replacement pattern in it", () => {
    expect(fill("a=${x};", { x: "$&$1$$" })).toBe("a=$&$1$$;");
  });

  it("throw for a slot with no value, naming it and the module", () => {
    expect(() => fill("a=${x};b=${y};", { x: "1.0" })).toThrow(/slot \$\{y\} that the module gives no value/);
  });

  it("throw for a value with no slot, naming it and the shader text", () => {
    expect(() => fill("a=${x};", { x: "1.0", z: "2.0" })).toThrow(/value for \$\{z\}, which the shader text does not have/);
  });

  it("throw for a `${` left in the result", () => {
    expect(() => fill("a=${x};b=${1};", { x: "1.0" })).toThrow(/still has "\$\{"/);
    expect(() => fill("a=${x};", { x: "${y}" })).toThrow(/still has "\$\{"/);
  });
});
