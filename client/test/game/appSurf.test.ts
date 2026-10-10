import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `app.ts` builds the peer-to-peer networking and a WebGL renderer, so nothing
 * here can start a hike under Node: the surf is wired as the lake's life is,
 * and read from the source as `appWaterLife.test.ts` reads that. The failure
 * it guards is the silent one: a shell built and never fed sounds nothing,
 * and the game looks the same.
 */
const src = readFileSync(fileURLToPath(new URL("../../src/app.ts", import.meta.url)), "utf8");

describe("the surf's sound in app.ts", () => {
  it("voices the surf after the lake's life, on BOTH the host and the client loop", () => {
    // Counting over the whole file would pass with both calls in the host loop.
    const loops = [...src.matchAll(/renderer\.sync\([^)]*\);\n\s*playWildlifeAudio\(\);\n\s*syncWind\(\);\n\s*syncDrip\(\);\n\s*syncWaterLife\(\);\n\s*syncSurf\(\);/g)];
    expect(loops).toHaveLength(2);
    expect(src.match(/syncSurf\(\);/g)).toHaveLength(2);
  });

  it("hears the renderer that runs, from its listener, so a switch of tier's renderer is the one heard", () => {
    const from = src.indexOf("  function syncSurf(): void {");
    expect(from).toBeGreaterThanOrEqual(0);
    const body = src.slice(from, src.indexOf("  /**", from));
    expect(body).toContain("if (surfAudio === null) return;");
    expect(body).toContain("surfAudio.update(renderer.surfSound(), renderer.listener());");
  });

  it("builds nothing for a world without the sea, builds it once, and disposes it before the context", () => {
    expect(src).toContain("const surfAudio = renderer.hasSea ? createSurfAudio(ambient) : null;");
    expect(src.match(/createSurfAudio\(/g)).toHaveLength(1);
    // A start that throws takes it down too.
    expect(src).toContain("made(() => surfAudio?.dispose());");
    const dispose = src.slice(src.lastIndexOf("    dispose() {\n      disposed = true;"));
    expect(dispose.indexOf("surfAudio?.dispose();")).toBeGreaterThan(dispose.indexOf("if (!broken) renderer.dispose();"));
    expect(dispose.indexOf("surfAudio?.dispose();")).toBeLessThan(dispose.indexOf("ambient.dispose();"));
  });
});
