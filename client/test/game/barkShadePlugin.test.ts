import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";

import { attachBarkShade, barkShadeVertexCode, type BarkShadePlugin } from "../../src/game/barkShadePlugin.js";

describe("bark shade plugin", () => {
  let engine: NullEngine | null = null;
  afterEach(() => {
    engine?.dispose();
    engine = null;
  });
  const make = (): PBRMaterial => {
    engine = new NullEngine();
    return new PBRMaterial("tree.giant_pine.material0", new Scene(engine));
  };

  it("moves every light's cascade texel to the trunk's axis at the vertex's height, and leaves the depth the vertex's own", () => {
    const code = barkShadeVertexCode();
    expect(code.startsWith("#if defined(BARK_SHADE) && defined(SHADOWS)\n")).toBe(true);
    expect(code).toContain("vec4 barkAxis = finalWorld * vec4(0.0, positionUpdated.y, 0.0, 1.0);");
    for (const x of [0, 1, 2, 3]) {
      expect(code).toContain(`#if defined(SHADOWCSM${x})`);
      expect(code).toContain(`vPositionFromLight${x}[i].xy = (lightMatrix${x}[i] * barkAxis).xy;`);
    }
    // The depth stays Babylon's: no depth metric, no depthValues, whose name
    // differs between the uniform-buffer path and WebGL2's.
    expect(code).not.toContain("vDepthMetric");
    expect(code).not.toContain("depthValues");
  });

  it("attaches once, on the vertex stage only, with no uniforms of its own", () => {
    const material = make();
    attachBarkShade(material);
    attachBarkShade(material);
    const plugin = material.pluginManager?.getPlugin("BarkShade") as BarkShadePlugin | undefined;
    expect(plugin).toBeDefined();
    expect(plugin?.getCustomCode("fragment")).toBeNull();
    expect(plugin?.getCustomCode("vertex")?.CUSTOM_VERTEX_MAIN_END).toBe(barkShadeVertexCode());
    expect(plugin?.getUniforms().ubo ?? []).toEqual([]);
  });
});
