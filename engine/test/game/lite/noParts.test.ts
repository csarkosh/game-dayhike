import { describe, expect, it } from "vitest";
import { sourceText } from "../../helpers/source.js";

describe("a renderer's side with no parts", () => {
  it("is the engine's own and names no game", () => {
    const text = sourceText("game/lite/noParts.ts");
    const specs = [...text.matchAll(/^import [^\n]*?from "([^"]+)";$/gm)].map((m) => m[1] as string);
    expect(specs.length).toBeGreaterThan(2);
    for (const spec of specs) expect(spec.startsWith("."), spec).toBe(true);
    expect(text).toContain("export const noParts: RenderGame<RenderState<RenderPlayer>, RenderPlayer, NoPartsApi> = () => {");
  });
});
