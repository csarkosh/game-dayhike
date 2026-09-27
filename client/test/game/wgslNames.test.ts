import { describe, expect, it } from "vitest";
import { pluginTexts } from "./helpers/pluginText.js";
import { terrainHexDefs } from "../../src/game/terrainTexture.js";
import { finishFragmentFor } from "../../src/game/post.js";

// WGSL's keywords and reserved words (the WGSL specification's lists). A GLSL
// name the translation carries through as one fails to parse on WebGPU.
const WGSL_RESERVED = new Set([
  "alias", "break", "case", "const", "const_assert", "continue", "continuing", "default", "diagnostic",
  "discard", "else", "enable", "false", "fn", "for", "if", "let", "loop", "override", "requires", "return",
  "struct", "switch", "true", "var", "while",
  "NULL", "Self", "abstract", "active", "alignas", "alignof", "as", "asm", "asm_fragment", "async",
  "attribute", "auto", "await", "become", "cast", "catch", "class", "co_await", "co_return", "co_yield",
  "coherent", "column_major", "common", "compile", "compile_fragment", "concept", "const_cast", "consteval",
  "constexpr", "constinit", "crate", "debugger", "decltype", "delete", "demote", "demote_to_helper", "do",
  "dynamic_cast", "enum", "explicit", "export", "extends", "extern", "external", "fallthrough", "filter",
  "final", "finally", "friend", "from", "fxgroup", "get", "goto", "groupshared", "highp", "impl",
  "implements", "import", "inline", "instanceof", "interface", "layout", "lowp", "macro", "macro_rules",
  "match", "mediump", "meta", "mod", "module", "move", "mut", "mutable", "namespace", "new", "nil",
  "noexcept", "noinline", "nointerpolation", "non_coherent", "noncoherent", "noperspective", "null",
  "nullptr", "of", "operator", "package", "packoffset", "partition", "pass", "patch", "pixelfragment",
  "precise", "precision", "premerge", "priv", "protected", "pub", "public", "readonly", "ref",
  "regardless", "register", "reinterpret_cast", "require", "resource", "restrict", "self", "set", "shared",
  "sizeof", "smooth", "snorm", "static", "static_assert", "static_cast", "std", "subroutine", "super",
  "target", "template", "this", "thread_local", "throw", "trait", "try", "type", "typedef", "typeid",
  "typename", "typeof", "union", "unless", "unorm", "unsafe", "unsized", "use", "using", "varying",
  "virtual", "volatile", "wgsl", "where", "with", "writeonly", "yield",
]);
const TYPES = "(?:void|bool|int|uint|float|[biu]?vec[234]|mat[234](?:x[234])?|sampler2D(?:Array)?(?:Shadow)?)";

/** Every name the GLSL declares after a type: variables, parameters, functions. */
function declaredNames(glsl: string): string[] {
  return [...glsl.matchAll(new RegExp(`\\b${TYPES}\\s+([A-Za-z_]\\w*)`, "g"))].map((m) => m[1] as string);
}

describe("GLSL names on the WebGPU path", () => {
  it("finds the declared names it scans for", () => {
    expect(declaredNames("vec3 macroRgb = macroTint(n, s); float f(sampler2D tex, vec2 uv)")).toEqual([
      "macroRgb",
      "f",
      "tex",
      "uv",
    ]);
  });

  it("declares no name WGSL reserves, on either assembly", () => {
    const texts = { ...pluginTexts(), "terrain.hex.webgpu": terrainHexDefs(true), "post.finish.webgpu": finishFragmentFor(true) };
    for (const [key, text] of Object.entries(texts)) {
      expect(declaredNames(text).filter((n) => WGSL_RESERVED.has(n)), key).toEqual([]);
    }
  });
});
