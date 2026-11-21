import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `app.ts` builds the peer-to-peer networking and a WebGPU renderer, so nothing
 * here can start a hike under Node: the lake's sound is wired as the animals'
 * is, and read from the source as `wildlifeAudio.test.ts` reads theirs. The
 * failure it guards is the silent one: a voice built and never fed hums
 * nothing, and the game looks the same.
 */
const src = readFileSync(fileURLToPath(new URL("../../../engine/src/app.ts", import.meta.url)), "utf8");

describe("the lake's sound in app.ts", () => {
  it("voices the lake after renderer.sync and the drips, in the one frame the host and a follower run", () => {
    // The host and a follower run one frame (`frame`, appFrame.test.ts), so each step is written once.
    const loops = [...src.matchAll(/renderer\.sync\([^)]*\);\n\s*playWildlifeAudio\(\);\n\s*syncWind\(\);\n\s*syncDrip\(\);\n\s*syncWaterLife\(\);/g)];
    expect(loops).toHaveLength(1);
    expect(src.match(/syncWaterLife\(\);/g)).toHaveLength(1);
  });

  it("hears the renderer that runs, from its listener, so a switch of tier's renderer is the one heard", () => {
    const from = src.indexOf("  function syncWaterLife(): void {");
    expect(from).toBeGreaterThanOrEqual(0);
    const body = src.slice(from, src.indexOf("  /**", from));
    expect(body).toContain("if (waterLifeAudio === null) return;");
    expect(body).toContain("waterLifeAudio.update(renderer.waterLifeSound(), renderer.listener());");
    // `renderer` is the one binding a switch replaces, read afresh each frame.
    // `R` is the game's renderer, whichever game the page is handed.
    expect(src).toContain("  let renderer: R = first.renderer;");
    expect(src.match(/\brenderer = got\.renderer;/g)).toHaveLength(1);
  });

  it("builds nothing for a world without the lake's life, and disposes it before the context", () => {
    expect(src).toContain("const waterLifeAudio = renderer.hasWaterLife ? createWaterLifeAudio(ambient) : null;");
    // A start that throws takes it down too.
    expect(src).toContain("made(() => waterLifeAudio?.dispose());");
    const dispose = src.slice(src.lastIndexOf("    dispose() {\n      disposed = true;"));
    expect(dispose.indexOf("waterLifeAudio?.dispose();")).toBeGreaterThan(dispose.indexOf("if (!broken) renderer.dispose();"));
    expect(dispose.indexOf("waterLifeAudio?.dispose();")).toBeLessThan(dispose.indexOf("ambient.dispose();"));
  });
});
