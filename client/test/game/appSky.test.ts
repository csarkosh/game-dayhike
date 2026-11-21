import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `app.ts` builds the peer-to-peer networking and a WebGPU renderer, so nothing
 * here can start a hike under Node: the sky's wiring is read from the source, as
 * `wildlifeAudio.test.ts` reads the audio's.
 */
const src = readFileSync(fileURLToPath(new URL("../../../engine/src/app.ts", import.meta.url)), "utf8");
// The escalation's sync is the hike's own (`hike.ts`, where a variable of `app.ts` is written `h.<name>`); the swap's restore stays in `app.ts`.
const hikeSrc = readFileSync(fileURLToPath(new URL("../../src/hike.ts", import.meta.url)), "utf8");

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
    expect(dispose.indexOf("renderer.dispose();")).toBeGreaterThan(0);
    expect(dispose.indexOf("skySource.dispose();")).toBeGreaterThan(dispose.indexOf("renderer.dispose();"));
  });

  it("hands its table to every renderer it builds: the first, and a swap's", () => {
    // Through the one way the page has to a renderer, the game's maker (`game.renderer`, Day Hike's `createHikeRenderer`:
    // `hikeGame.test.ts`), which hands it over as the hike holds it.
    expect(src.match(/\bgame\.renderer\(/g)).toHaveLength(2);
    expect(src).not.toMatch(/\bcreateHikeRenderer\(/);
    expect(src).not.toMatch(/\bcreateRenderer\(/);
    expect(src).toContain(
      // The first renderer is also told where the hike starts (`start`), so its first terrain and water are built
      // there, handed what the world's worker sampled there (`prepared`, taken once), and given the loader of first
      // builds a start under a film has (`firstBuilds`).
      "game.renderer(next, level, forest, { tier: at, deferClipmap: options.deferClipmap, start, prepared: options.takePrepared?.() ?? null, firstBuilds, skyTable: skySource.table, gpuTime: parseGpuTime(location.search), paced: isMobile(navigator) }),",
    );
    expect(src).toContain(
      "build: (next, target) => game.renderer(next, level, forest, { tier: target, skyTable: skySource.table, gpuTime: parseGpuTime(location.search), paced: isMobile(navigator) }),",
    );
  });

  it("moves the hour and the weather in one apply, in the escalation's sync and in a swap's restore", () => {
    const sync = hikeSrc.slice(hikeSrc.indexOf("  function syncAtmosphere("), hikeSrc.indexOf("  let signs: HikeSigns | null = null;"));
    // The audio hears the settled weather; the view, the mist the end scene's road shot draws back.
    expect(sync).toContain("    h.renderer.setView(a.hour, a.weather);\n    h.ambient.setWeather(settled.weather);");
    expect(sync).not.toMatch(/h\.renderer\.set(?:Hour|Weather)\(/);
    // The sun's light alone, on every frame, ahead of the gate (2026-10-18).
    expect(sync.indexOf("    h.renderer.followHour(a.hour);\n")).toBeGreaterThan(sync.indexOf("    const a = mist === 1"));
    expect(sync.indexOf("    h.renderer.followHour(a.hour);\n")).toBeLessThan(sync.indexOf("    const hourMoved ="));
    const restore = src.slice(src.indexOf("  function restoreView(r: R): void {"), src.indexOf("  const swapBindings: SwapBindings<R> = {"));
    expect(restore).toContain("    r.setView(appliedHour, appliedWeather);");
    expect(restore).not.toMatch(/r\.set(?:Hour|Weather)\(/);
  });

  it("starts the loop, and so shows the world, only once the clipmap stands and the sky's first slices are in, on either start", () => {
    expect(src).toContain(
      "  const firstBuild = Promise.all([clipmapBuilt, whenStandingSkyHeld(() => renderer, nextSwap)]).then(() => {\n    if (!disposed && !broken && renderer === built) built.runLoop(loop);\n  });",
    );
    // A swap meanwhile hands the wait to the renderer it builds: it is told, once, as the renderer changes.
    expect(src).toContain("      renderer = got.renderer;\n      for (const tell of swapListeners) tell();\n      swapListeners.clear();");
    expect(src.match(/\brenderer = got\.renderer;/g)).toHaveLength(1);
    // The first build's, and the governor's restart after it times the idle
    // frames; a swap's own runs in `rendererSwap.ts`.
    expect(src.match(/\.runLoop\(loop\)/g)).toHaveLength(2);
    expect(src).toContain("  const ready = firstBuild.then(() =>");
  });
});
