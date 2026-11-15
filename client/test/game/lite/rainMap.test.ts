import { describe, expect, it } from "vitest";
import { RAIN_MAP_RINGS, RAIN_MAP_WGSL, rainMapPlugin } from "../../../src/game/lite/rainMap.js";
import { TERRAIN_VERTEX_FLOATS, TERRAIN_VERTEX_LAYOUT } from "../../../src/game/lite/terrainPlugins.js";
import { RAIN_HEIGHT_FRAGMENT, RAIN_HEIGHT_VERTEX } from "../../../src/game/rainMap.js";
import { rainMapTexel } from "../../../src/game/rainCover.js";
import { RAIN_MAP } from "../../../src/game/rainParams.js";
import { TERRAIN_ATTRIBUTES } from "../../../src/game/terrainVertices.js";
import { tight } from "./wgslText.js";

const GLSL = tight(RAIN_HEIGHT_FRAGMENT);

describe("the cover map's texel on Babylon Lite", () => {
  it("is the height shader's for the terrain: the canopy's transmission and its lift", () => {
    expect(GLSL).toContain("#ifdefRAIN_HEIGHT_TERRAINfloattransmission=1.0-0.65*vCanopy;floatlift=10.0*step(0.01,vCanopy);");
    expect(GLSL).toContain("gl_FragColor=vec4(vHeight,transmission,lift,1.0);");
    expect(tight(RAIN_MAP_WGSL.terrain)).toBe(
      "{letvHeight=input.worldPos.y;letvCanopy=input.vRainCanopy;lettransmission=1.0-0.65*vCanopy;letlift=10.0*step(0.01,vCanopy);color=vec3<f32>(vHeight,transmission,lift);alpha=1.0;}",
    );
  });

  it("is the height shader's for hard cover: nothing through, no lift", () => {
    expect(GLSL).toContain("#elsefloattransmission=0.0;floatlift=0.0;#endif");
    expect(tight(RAIN_MAP_WGSL.hard)).toBe("{letvHeight=input.worldPos.y;lettransmission=0.0;letlift=0.0;color=vec3<f32>(vHeight,transmission,lift);alpha=1.0;}");
    // The numbers are the engine-free mirror's.
    expect(rainMapTexel("terrain", 0, 1)).toEqual({ height: 0, transmission: 1 - RAIN_MAP.canopyBlock, lift: RAIN_MAP.canopyLift });
  });

  it("takes the height as the world's and the canopy from the terrain's own vertex data, where the height shader reads them", () => {
    expect(RAIN_HEIGHT_VERTEX).toContain("vHeight = worldPos.y;");
    expect(RAIN_HEIGHT_VERTEX).toContain("vCanopy = terrainWeights2.w;");
    expect(TERRAIN_ATTRIBUTES.weights2).toBe("terrainWeights2");
    const plugin = rainMapPlugin("terrain");
    expect(plugin.getCustomCode?.("vertex")).toEqual({ CUSTOM_VERTEX_MAIN_END: "out.vRainCanopy=terrainWeights2.w;" });
    expect(plugin.getVaryings?.()).toEqual([{ name: "vRainCanopy", type: "f32" }]);
    // The one attribute it declares sits where the terrain's own plugin lays it, in the terrain's stride.
    const weights2 = TERRAIN_VERTEX_LAYOUT.find((part) => part.name === "terrainWeights2");
    expect(weights2?.floats).toBe(4);
    expect(plugin.getVertexAttributes?.()).toEqual([
      { name: "terrainWeights2", type: "vec4<f32>", format: "float32x4", stride: TERRAIN_VERTEX_FLOATS * 4, offset: (weights2?.offset ?? -1) * 4 },
    ]);
  });

  it("writes the texel last in the fragment, in place of the lit colour, and reads no vertex data for hard cover", () => {
    for (const kind of ["terrain", "hard"] as const) {
      const plugin = rainMapPlugin(kind);
      expect(Object.keys(plugin.getCustomCode?.("fragment") ?? {})).toEqual(["CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR"]);
      expect(plugin.getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toBe(RAIN_MAP_WGSL[kind]);
    }
    const hard = rainMapPlugin("hard");
    expect(hard.getVertexAttributes).toBeUndefined();
    expect(hard.getCustomCode?.("vertex")).toBeNull();
    expect(rainMapPlugin("terrain").name).not.toBe(hard.name);
  });

  it("holds the two finest rings, which cover its square", () => {
    expect(RAIN_MAP_RINGS).toBe(2);
  });
});
