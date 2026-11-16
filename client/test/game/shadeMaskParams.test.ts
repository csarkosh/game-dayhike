import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NullEngine, NullEngineOptions } from "@babylonjs/core/Engines/nullEngine.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { Scene } from "@babylonjs/core/scene.js";
import {
  SHADE_MASK_RATIO, SHADE_SMOKE_FOLD_S, SHADE_SMOKE_FRAY, SHADE_SMOKE_SWELL_M, shadeMaskColour, shadeMaskSide, shadeMaskSize, shadeSmokeSeconds, shadeSmokeUniforms,
} from "../../src/game/shadeMaskParams.js";

const src = (name: string): string => readFileSync(new URL(`../../src/game/${name}`, import.meta.url), "utf8");

describe("what the haunt's figures are drawn into their mask with", () => {
  it("sizes the mask as Babylon.js sizes a render target given the mask's ratio, at every frame's size", () => {
    for (const [width, height] of [[1470, 956], [1920, 1080], [2560, 1440], [1280, 720], [975, 776], [640, 360], [390, 844], [300, 150], [3840, 2160]] as const) {
      const options = new NullEngineOptions();
      options.renderWidth = width;
      options.renderHeight = height;
      const engine = new NullEngine(options);
      const scene = new Scene(engine);
      const target = new RenderTargetTexture("mask", { ratio: SHADE_MASK_RATIO }, scene);
      expect(shadeMaskSize(width, height), `${width} by ${height}`).toEqual({ width: target.getSize().width, height: target.getSize().height });
      scene.dispose();
      engine.dispose();
    }
    // A laptop's window: half of 1470 is 735, taken to 512, the nearer power of two.
    expect(shadeMaskSize(1470, 956)).toEqual({ width: 512, height: 512 });
    expect(shadeMaskSide(1920)).toBe(1024);
  });

  it("colours a figure by its softness and how near it is: red the shade, blue the real thing, no green", () => {
    expect(shadeMaskColour(1, 1)).toEqual([1, 0, 0]);
    expect(shadeMaskColour(0, 1)).toEqual([0, 0, 1]);
    expect(shadeMaskColour(0.5, 0.4)).toEqual([0.2, 0, 0.5]);
    const out: [number, number, number] = [9, 9, 9];
    expect(shadeMaskColour(1, 0.25, out)).toBe(out);
    expect(out).toEqual([0.25, 0, 0]);
  });

  it("gives the smoke its figure's values and its own two, and folds its clock at an hour", () => {
    expect(shadeSmokeUniforms(0.25, 12, 140, 5.4)).toEqual({ shadeSmoke: [0.25, 12, 140, 5.4], shadeSmokeEdge: [SHADE_SMOKE_FRAY, SHADE_SMOKE_SWELL_M] });
    expect(shadeSmokeSeconds(12_500)).toBe(12.5);
    expect(shadeSmokeSeconds((SHADE_SMOKE_FOLD_S + 3) * 1000)).toBe(3);
  });

  it("is what the shells on Babylon.js read: the mask's size, a figure's colour and the smoke's numbers", () => {
    const silhouette = src("shadeSilhouette.ts");
    expect(silhouette).toContain("shadeMaskColour(e.soft, e.near, maskColour)");
    expect(silhouette).toContain("shadeSmokeSeconds(performance.now() - started)");
    expect(silhouette).toContain('{ ratio: SHADE_MASK_RATIO }');
    const smoke = src("shadeSmoke.ts");
    expect(smoke).toContain("shadeSmokeUniforms(this.presence, this.time, this.feetY, this.height");
    expect(smoke).toMatch(/export \{[^}]*SHADE_SMOKE_SCALE[^}]*\} from "\.\/shadeMaskParams\.js";/);
    expect(src("shadeMaskParams.ts")).not.toMatch(/@babylonjs/);
  });
});
