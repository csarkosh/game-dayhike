import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `app.ts` builds the peer-to-peer networking and a WebGL renderer, so nothing
 * here can start a hike under Node: the sky's wiring is read from the source, as
 * `wildlifeAudio.test.ts` reads the audio's.
 */
const src = readFileSync(fileURLToPath(new URL("../../src/app.ts", import.meta.url)), "utf8");

describe("the hike's sky", () => {
  it("makes one source for the hike's life, from the hour the script starts it at", () => {
    expect(src.match(/\bstartSkySource\(/g)).toHaveLength(1);
    expect(src).toContain('  const timeEntry = lastEntry(view, "time");');
    expect(src).toContain('  const startHour = typeof timeValue === "number" ? timeValue : DEFAULT_HOUR;');
    expect(src).toContain("  const skySource = startSkySource(sunAltitudeDeg(startHour));");
  });

  it("stops it with a start that throws, and on dispose after the renderer", () => {
    expect(src).toContain("  made(() => skySource.dispose());");
    const dispose = src.slice(src.lastIndexOf("    dispose() {\n      disposed = true;"));
    expect(dispose.indexOf("skySource.dispose();")).toBeGreaterThan(dispose.indexOf("if (!broken) renderer.dispose();"));
  });

  it("hands its table to every renderer it builds: the first, and a swap's", () => {
    expect(src.match(/\bcreateRenderer\(/g)).toHaveLength(2);
    expect(src).toContain(
      "createRenderer(next, level, forest, { tier: at, engine: engine ?? undefined, pipelines: pipelinesFor(engine), deferClipmap: options.deferClipmap, skyTable: skySource.table }),",
    );
    expect(src).toContain(
      "build: (next, target, engine) => createRenderer(next, level, forest, { tier: target, engine: engine ?? undefined, pipelines: pipelinesFor(engine), skyTable: skySource.table }),",
    );
  });

  it("starts the loop, and so shows the world, only once the clipmap stands and the sky's first slices are in, on either start", () => {
    expect(src).toContain(
      "  const firstBuild = Promise.all([clipmapBuilt, built.skyReady()]).then(() => {\n    if (!disposed && !broken && renderer === built) built.engine.runRenderLoop(loop);\n  });",
    );
    // The first build's, and the governor's restart after it times the idle
    // frames; a swap's own runs in `rendererSwap.ts`.
    expect(src.match(/\.runRenderLoop\(loop\)/g)).toHaveLength(2);
    expect(src).toContain("  const ready = firstBuild.then(() =>");
  });
});
