import { describe, it, expect, vi, beforeAll } from "vitest";

// The ground arrays decode images node cannot: one-texel stand-ins.
vi.mock("../../src/game/groundMaps.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/game/groundMaps.js")>();
  const { RawTexture } = await import("@babylonjs/core/Materials/Textures/rawTexture.js");
  return {
    ...actual,
    loadGroundArrays: (scene: import("@babylonjs/core/scene.js").Scene) => {
      const texture = (name: string) => {
        const made = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene);
        made.name = name;
        return made;
      };
      return { normals: texture("terrainNormals"), rah: texture("terrainRAH"), ready: Promise.resolve(), dispose() {} };
    },
  };
});

import "../../src/sim/passes/index.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { createAtmosphere } from "../../src/game/atmosphere.js";
import { createHeadlamp } from "../../src/game/headlamp.js";
import { createClipmap } from "../../src/game/renderer.js";
import { seedFromToken } from "../../src/game/seed.js";
import { FOG_DISTANCE } from "../../src/sim/forestConstants.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, probeReady, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";

/**
 * NullEngine compiles no GLSL, and on WebGL2 it keeps every conditional for
 * the driver, so a text test of the terrain's fragment passes a stage the
 * browser would refuse. Here the terrain is built as the renderer builds it
 * (the atmosphere, the camera, the local headlamp as light 0, the sun as
 * light 1 and the fill as light 2, then the clipmap, which turns the road,
 * trail and feature paints on), processed as Babylon's WebGPU engine
 * processes it, which resolves the conditionals, and handed to glslang and
 * twgsl as the page hands it. Fog is set as the lighting sets it: the
 * atmosphere's fog line reads the fog colour.
 */
type Stages = { defines: string; fragment: string; vertex: string; wgslFragment: string; wgslVertex: string };

async function terrainStages(translators: StartedTranslators, prepare?: (scene: Scene) => void): Promise<Stages> {
  const engine = webgpuProcessingEngine();
  const scene = new Scene(engine);
  const atmosphere = createAtmosphere(scene, FOG_DISTANCE);
  scene.activeCamera = new UniversalCamera("player", new Vector3(0, 2, 0), scene);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.01;
  createHeadlamp(scene, "lamp_local");
  new DirectionalLight("sun", new Vector3(0.3, -0.8, 0.5), scene);
  new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  const clipmap = createClipmap(scene, seedFromToken("atmo"));
  try {
    // The material is made on a WebGL2 engine's terms; its plugin's code is
    // asked for at the compile, now as WebGPU's.
    (engine as unknown as { _isWebGPU: boolean })._isWebGPU = true;
    prepare?.(scene);
    probeReady(scene);
    const effect = await drawnEffect(clipmap.meshes[0] as Mesh);
    const defines = (effect as unknown as { defines: string }).defines;
    const translate = (stage: "vertex" | "fragment", code: string): string =>
      translateStage(translators, { stage, flag: uniformityOff(code), glsl: translatorInput(code, defines) }) as string;
    return {
      defines,
      fragment: effect._fragmentSourceCode,
      vertex: effect._vertexSourceCode,
      wgslFragment: translate("fragment", effect._fragmentSourceCode),
      wgslVertex: translate("vertex", effect._vertexSourceCode),
    };
  } finally {
    clipmap.dispose();
    atmosphere.dispose();
    scene.dispose();
    engine.dispose();
  }
}

describe("the terrain's stages with the far cover, through glslang and twgsl", () => {
  let translators: StartedTranslators;
  beforeAll(async () => { translators = await startTranslators(); }, timeLimit(60_000));

  it("compiles the include and the colour block, the medium and high band chosen", async () => {
    const t = await terrainStages(translators);
    expect(t.defines).not.toContain("TERRAINFARLOW");
    expect(t.fragment).toContain("const vec2 FAR_COVER_BAND = vec2(24.0, 30.0);");
    expect(t.fragment).not.toContain("vec2(14.4, 18.0)");
    expect(t.fragment).toContain("terrainFarW = farCoverWeight(vTerrainCover, vTerrainW2.z, dist);");
    expect(t.wgslFragment).toContain("@fragment");
    expect(t.wgslFragment).toMatch(/fn farCoverWeight_/);
    expect(t.wgslFragment).toMatch(/fn farClumpOctave_/);
    expect(t.wgslFragment).toMatch(/fn farClump_/);
    expect(t.wgslVertex).toContain("@vertex");
  }, timeLimit(60_000));

  it("compiles the specular rewrite and the far light", async () => {
    const t = await terrainStages(translators);
    expect(t.fragment.split("vec4 metallicReflectanceFactors=vec4(vMetallicReflectanceFactors.rgb,vMetallicReflectanceFactors.a*terrainSpecW);").length - 1).toBe(1);
    expect(t.fragment).toContain("terrainFarW *= 1.0 - terrainPaintW;");
    expect(t.fragment).toContain("terrainSpecW = 1.0 - FAR_SPEC_CUT * terrainFarW * (1.0 - terrainWet);");
    expect(t.wgslFragment).toContain("@fragment");
  }, timeLimit(60_000));

  it("gives the sun's line alone the cover's factor once the lights are resolved", async () => {
    const t = await terrainStages(translators);
    expect(t.defines).toContain("#define SPOTLIGHT0\n");
    expect(t.defines).toContain("#define DIRLIGHT1\n");
    expect(t.defines).toContain("#define HEMILIGHT2\n");
    expect(t.fragment.split(")*mix(1.0,min(clamp(dot(terrainFarN,preInfo.L)").length - 1).toBe(1);
    expect(t.fragment).toContain("info.diffuse=computeDiffuseLighting(preInfo,diffuse1.rgb)*mix(1.0,min(");
    expect(t.fragment.split("info.diffuse=computeDiffuseLighting(preInfo,diffuse0.rgb);").length - 1).toBe(1);
    expect(t.wgslFragment).toContain("@fragment");
  }, timeLimit(60_000));
});
