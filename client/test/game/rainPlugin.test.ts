import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { WebGL2ShaderProcessor } from "@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors.js";
import { attachRain, RainPlugin } from "../../src/game/rainPlugin.js";
import { createRain } from "../../src/game/rain.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

function pluginFor(name: string): RainPlugin {
  const mat = new StandardMaterial(name, scene);
  return attachRain(mat);
}

/** Every `uniform <type> <name>;` a GLSL string declares. */
function declaredUniforms(glsl: string): string[] {
  return [...glsl.matchAll(/uniform\s+\w+\s+(\w+);/g)].map((m) => m[1] as string);
}

describe("the rain plugin", () => {
  it("attaches once per material and is the material's active plugin", () => {
    const mat = new StandardMaterial("rp1", scene);
    const first = attachRain(mat);
    expect(attachRain(mat)).toBe(first);
    expect(mat.pluginManager?.getPlugin("Rain")).toBeInstanceOf(RainPlugin);
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active.filter((p) => p instanceof RainPlugin)).toHaveLength(1);
    expect(first.getClassName()).toBe("RainPlugin");
    expect(first.priority).toBe(220);
  });

  it("declares the three defines, the seed attribute, the uniforms on both lists, and the four hooks", () => {
    const plugin = pluginFor("rp2");
    const defines: Record<string, boolean> = { RAIN: false, RAIN_DRIP: false, RAIN_OCCLUSION: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines).toEqual({ RAIN: true, RAIN_DRIP: false, RAIN_OCCLUSION: false });
    const attrs: string[] = [];
    plugin.getAttributes(attrs, scene, undefined as never);
    expect(attrs).toEqual(["rainSeed"]);
    const uniforms = plugin.getUniforms();
    const names = [
      "rainBoxMin", "rainBoxSize", "rainDrift", "rainFold", "rainDt", "rainWind", "rainCam",
      "rainLampPos", "rainLampDir", "rainLamp", "rainSpeeds", "rainWidths", "rainAlphas", "rainLampColour",
    ];
    expect(uniforms.ubo.map((u) => u.name)).toEqual(names);
    expect([...declaredUniforms(uniforms.vertex), ...declaredUniforms(uniforms.fragment)]).toEqual(names);
    expect(Object.keys(plugin.getCustomCode("vertex")!).sort()).toEqual(
      ["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_POSITION"],
    );
    expect(Object.keys(plugin.getCustomCode("fragment")!).sort()).toEqual(
      ["CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR", "CUSTOM_FRAGMENT_DEFINITIONS"],
    );
    expect(plugin.getCustomCode("other")).toBeNull();
  });

  it("writes every uniform it declares in bindForSubMesh, from its fields and the classes", () => {
    const plugin = pluginFor("rp3");
    plugin.boxMinX = -2; plugin.boxMinY = -7; plugin.boxMinZ = -26;
    plugin.driftX = 0.25; plugin.driftZ = 0.5;
    plugin.fold = 3; plugin.dt = 1 / 60;
    plugin.windX = 0; plugin.windZ = 3;
    plugin.camX = 10; plugin.camY = 5; plugin.camZ = -20;
    plugin.lampX = 10; plugin.lampY = 5; plugin.lampZ = -20;
    plugin.lampDirX = 0; plugin.lampDirY = 0; plugin.lampDirZ = 1;
    plugin.lampIntensity = 3; plugin.lampCosHalf = 0.7;
    plugin.lampR = 1; plugin.lampG = 0.9; plugin.lampB = 0.8;
    const writes: Record<string, number[]> = {};
    const ubo = {
      updateFloat: (n: string, a: number) => { writes[n] = [a]; },
      updateFloat2: (n: string, a: number, b: number) => { writes[n] = [a, b]; },
      updateFloat3: (n: string, a: number, b: number, c: number) => { writes[n] = [a, b, c]; },
      updateFloat4: (n: string, a: number, b: number, c: number, d: number) => { writes[n] = [a, b, c, d]; },
    } as unknown as UniformBuffer;
    plugin.bindForSubMesh(ubo, scene, engine, undefined as never);
    expect(Object.keys(writes).sort()).toEqual(plugin.getUniforms().ubo.map((u) => u.name).sort());
    expect(writes).toEqual({
      rainBoxMin: [-2, -7, -26],
      rainBoxSize: [24, 20, 24],
      rainDrift: [0.25, 0.5],
      rainFold: [3],
      rainDt: [1 / 60],
      rainWind: [0, 3],
      rainCam: [10, 5, -20],
      rainLampPos: [10, 5, -20],
      rainLampDir: [0, 0, 1],
      rainLamp: [3, 0.7],
      rainSpeeds: [4.5, 6, 7.5, 9],
      rainWidths: [0.012, 0.018, 0.024, 0.03],
      rainAlphas: [0.35, 0.43, 0.52, 0.6],
      rainLampColour: [1, 0.9, 0.8],
    });
  });

  it("places the drop by the fold, stretches it by the frame, fades it by distance, sky, class and lamp, and multiplies the alpha", () => {
    const plugin = pluginFor("rp4");
    const vertex = plugin.getCustomCode("vertex")!.CUSTOM_VERTEX_UPDATE_POSITION!;
    expect(vertex).toContain("fract(rainSeed.xyz + rDrift - rainBoxMin / rainBoxSize)");
    expect(vertex).toContain("-rSpeed * rainFold / rainBoxSize.y");
    expect(vertex).toContain("positionUpdated = rp + rRight * (position.x * rWidth) + rAlong * (position.y * rLen)");
    // The literals rainParams.ts carries, written into the GLSL from it.
    expect(vertex).toContain("clamp(rSpeed * rainDt * 1.5, 0.08, 0.5)");
    expect(vertex).toContain("float rFade = smoothstep(0.6, 1.5, rDist) * (1.0 - smoothstep(9.0, 12.0, rDist))");
    expect(vertex).toContain("float rSky = 1.0 - 0.6 * smoothstep(0.0, 0.25, -rView.y)");
    expect(vertex).toContain("float rLampT = rainLamp.x * rCone / (1.0 + rLampD2)");
    // The fades gate the lamp term too: a drop at the eye never becomes an opaque slab.
    expect(vertex).toContain("vRainAlpha = min(rFade * (rSky * rClassAlpha + rLampT), 1.0)");
    expect(vertex).toContain("vRainLamp = min(rLampT, 1.0)");
    const fragment = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR!;
    expect(fragment).toContain("color.rgb = mix(color.rgb, rainLampColour, vRainLamp);");
    expect(fragment).toContain("color.a *= vRainAlpha;");
  });

  it("never spells a hashed preprocessor keyword in a comment, nor a semicolon in a trailing one", () => {
    const plugin = pluginFor("rp5");
    const all = [
      ...Object.values(plugin.getCustomCode("vertex")!),
      ...Object.values(plugin.getCustomCode("fragment")!),
      plugin.getUniforms().vertex,
      plugin.getUniforms().fragment,
    ].join("\n");
    for (const line of all.split("\n")) {
      const comment = line.indexOf("//");
      if (comment === -1) continue;
      expect(line.slice(comment)).not.toMatch(/#\s*(if|ifdef|ifndef|else|elif|endif|define)/);
      if (!line.trim().startsWith("//")) expect(line.slice(comment)).not.toContain(";");
    }
  });

  it("migrates to GLSL 300 es with the attribute and the varying intact", async () => {
    const plugin = pluginFor("rp6");
    const vert = await processInjected(
      plugin.getUniforms().vertex + plugin.getCustomCode("vertex")!.CUSTOM_VERTEX_DEFINITIONS!, ["RAIN"], false,
    );
    expect(vert).toContain("in vec4 rainSeed");
    expect(vert).toContain("out float vRainAlpha");
    expect(vert).toContain("out float vRainLamp");
    expect(vert).toContain("uniform vec3 rainBoxMin");
    const frag = await processInjected(
      plugin.getUniforms().fragment + plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS!, ["RAIN"], true,
    );
    expect(frag).toContain("in float vRainAlpha");
    expect(frag).toContain("in float vRainLamp");
    expect(frag).toContain("uniform vec3 rainLampColour");
  });
});

describe("the rain material's stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => { translators = await startTranslators(); }, timeLimit(60_000));

  it("compile through glslang and translate to WGSL as Babylon's WebGPU processing hands them over, fog on", async () => {
    const gpu = webgpuProcessingEngine();
    const gpuScene = new Scene(gpu);
    try {
      new UniversalCamera("c", new Vector3(0, 2, 0), gpuScene);
      gpuScene.fogMode = Scene.FOGMODE_EXP2;
      const rain = createRain(gpuScene, "low");
      rain.mesh.setEnabled(true);
      const effect = await drawnEffect(rain.mesh);
      expect(effect._vertexSourceCode).toContain("rainSeed");
      expect(effect._vertexSourceCode).toContain("vRainAlpha");
      expect(effect._fragmentSourceCode).toContain("color.a *= vRainAlpha");
      // Each stage composed as the page composes it for the first translator
      // (`shaderLookup.ts`): a stage that does not parse throws here, with
      // glslang's line and message on stderr.
      const defines = (effect as unknown as { defines: string }).defines;
      const stage = (kind: "vertex" | "fragment", code: string) =>
        translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
      const vertex = stage("vertex", effect._vertexSourceCode);
      const fragment = stage("fragment", effect._fragmentSourceCode);
      expect(vertex).toContain("rainSeed");
      expect(vertex).toContain("vRainAlpha");
      expect(fragment).toContain("vRainAlpha");
      rain.dispose();
    } finally {
      gpuScene.dispose();
      gpu.dispose();
    }
  }, timeLimit(60_000));
});

function processInjected(source: string, defines: string[], isFragment: boolean): Promise<string> {
  const options: _IProcessingOptions = {
    defines, indexParameters: {}, isFragment, shouldUseHighPrecisionShader: true,
    supportsUniformBuffers: true, shadersRepository: "", includesShadersStore: {},
    processor: new WebGL2ShaderProcessor(), version: "300", platformName: "WEBGL2",
    processingContext: null, isNDCHalfZRange: false, useReverseDepthBuffer: false,
  };
  return new Promise((resolve) => {
    Process(source, options, (migrated) => resolve(migrated), engine);
  });
}
