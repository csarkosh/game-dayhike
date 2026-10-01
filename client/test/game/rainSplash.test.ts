import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { WebGL2ShaderProcessor } from "@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors.js";
import { attachSplash, createRainSplash, SplashPlugin } from "../../src/game/rainSplash.js";
import type { RainLamp } from "../../src/game/rain.js";
import { createRainMap, type RainMap } from "../../src/game/rainMap.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";

const CAM = { x: 10, y: 5, z: -20 };
const LAMP_OFF: RainLamp = { x: 10, y: 5, z: -20, dx: 0, dy: 0, dz: 1, intensity: 0, angle: 1.5, r: 1, g: 0.9, b: 0.8 };
const LAMP_ON: RainLamp = { ...LAMP_OFF, intensity: 400 };
/** The light's travel at noon-ish: down and a little north. */
const SUN_UP = { x: 0, y: -0.8, z: 0.6 };
/** And at night: up. */
const SUN_DOWN = { x: 0, y: 0.8, z: -0.6 };

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

/** Every `uniform <type> <name>;` a GLSL string declares. */
function declaredUniforms(glsl: string): string[] {
  return [...glsl.matchAll(/uniform\s+\w+\s+(\w+);/g)].map((m) => m[1] as string);
}

describe("createRainSplash", () => {
  it("is null on low, and one thin-instanced quad per ring of the tier on medium and high, disabled, with the plugin attached once", () => {
    expect(createRainSplash(scene, "low")).toBeNull();
    for (const [tier, count] of [["medium", 600], ["high", 1200]] as const) {
      const splash = createRainSplash(scene, tier)!;
      expect(splash.mesh.name).toBe("rain_splashes");
      expect(splash.mesh.thinInstanceCount).toBe(count);
      expect(splash.mesh.isEnabled()).toBe(false);
      expect(splash.mesh.isPickable).toBe(false);
      expect(splash.mesh.receiveShadows).toBe(false);
      expect(splash.mesh.alwaysSelectAsActiveMesh).toBe(true);
      expect(splash.mesh.doNotSyncBoundingInfo).toBe(true);
      // First of the rain's blended meshes: before the drips and the streaks.
      expect(splash.mesh.alphaIndex).toBe(Number.MAX_SAFE_INTEGER - 2);
      expect(splash.plugin).toBeInstanceOf(SplashPlugin);
      const mat = splash.mesh.material as StandardMaterial;
      expect(mat.name).toBe("mat_rain_splash");
      expect(mat.pluginManager?.getPlugin("Splash")).toBe(splash.plugin);
      const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
      expect(active.filter((p) => p instanceof SplashPlugin)).toHaveLength(1);
      splash.dispose();
    }
  });

  it("is unlit, alpha-blended with no texture, depth-tested but not written, two-sided and fogged", () => {
    const splash = createRainSplash(scene, "medium")!;
    const mat = splash.mesh.material as StandardMaterial;
    expect(mat.disableLighting).toBe(true);
    expect(mat.alpha).toBe(1);
    expect(mat.diffuseTexture).toBeNull();
    expect(mat.needAlphaBlending()).toBe(true);
    expect(mat.needAlphaTesting()).toBe(false);
    expect(mat.backFaceCulling).toBe(false);
    expect(mat.disableDepthWrite).toBe(true);
    expect(mat.fogEnabled).toBe(true);
    splash.dispose();
  });

  it("draws the rain value's share of the tier's rings while a map is set, and nothing at clear or without a map", () => {
    const splash = createRainSplash(scene, "high")!;
    const map = createRainMap(scene, "high") as RainMap;
    splash.update(CAM, WEATHER_PRESETS.rain, LAMP_OFF, SUN_UP, 0);
    expect(splash.mesh.isEnabled()).toBe(false);
    splash.setMap(map);
    expect(splash.plugin.map).toBe(map.texture);
    splash.update(CAM, WEATHER_PRESETS.rain, LAMP_OFF, SUN_UP, 0);
    expect(splash.mesh.isEnabled()).toBe(true);
    expect(splash.mesh.thinInstanceCount).toBe(1200);
    splash.update(CAM, { ...WEATHER_PRESETS.rain, rain: 0.25 }, LAMP_OFF, SUN_UP, 0);
    expect(splash.mesh.isEnabled()).toBe(true);
    expect(splash.mesh.thinInstanceCount).toBe(300);
    splash.update(CAM, WEATHER_PRESETS.clear, LAMP_OFF, SUN_UP, 0);
    expect(splash.mesh.isEnabled()).toBe(false);
    splash.update(CAM, WEATHER_PRESETS.rain, LAMP_OFF, SUN_UP, 0);
    expect(splash.mesh.isEnabled()).toBe(true);
    splash.setMap(null);
    expect(splash.plugin.map).toBeNull();
    splash.update(CAM, WEATHER_PRESETS.rain, LAMP_OFF, SUN_UP, 0);
    expect(splash.mesh.isEnabled()).toBe(false);
    splash.dispose();
    map.dispose();
  });

  it("hands the plugin the folded time, the eye, the rain, the sun while it is up, the lamp, the map's centre and the fog's milk", () => {
    scene.fogColor.set(0.5, 0.5, 0.5);
    const splash = createRainSplash(scene, "high")!;
    const map = createRainMap(scene, "high") as RainMap;
    splash.setMap(map);
    map.update({ x: 30, y: 5, z: -20 });
    splash.update(CAM, { ...WEATHER_PRESETS.rain, rain: 0.5 }, LAMP_ON, SUN_UP, 37);
    const p = splash.plugin;
    // 37 s folds at 36 to 1.
    expect(p.time).toBe(1);
    expect([p.camX, p.camY, p.camZ]).toEqual([10, 5, -20]);
    expect(p.rain).toBe(0.5);
    // The sun's light travelling down at 0.8: well above the 0.1 fade, so the direction whole.
    expect([p.sunX, p.sunY, p.sunZ]).toEqual([0, -0.8, 0.6]);
    expect([p.lampX, p.lampY, p.lampZ]).toEqual([10, 5, -20]);
    expect([p.lampDirX, p.lampDirY, p.lampDirZ]).toEqual([0, 0, 1]);
    // 400 light units at the gain of 0.005 is 2; the cone's edge is cos(0.75).
    expect(p.lampIntensity).toBeCloseTo(2, 9);
    expect(p.lampCosHalf).toBeCloseTo(Math.cos(0.75), 9);
    expect([p.mapCentreX, p.mapCentreZ]).toEqual([30, -20]);
    const mat = splash.mesh.material as StandardMaterial;
    expect(mat.emissiveColor.r).toBeCloseTo(0.625, 9);
    expect(mat.emissiveColor.g).toBeCloseTo(0.625, 9);
    expect(mat.emissiveColor.b).toBeCloseTo(0.625, 9);
    // At night the sun's backlight is gone; the light at 0.05 down is half way in.
    splash.update(CAM, WEATHER_PRESETS.rain, LAMP_OFF, SUN_DOWN, 0);
    expect([p.sunX, p.sunY, p.sunZ].map((v) => v + 0)).toEqual([0, 0, 0]);
    expect(p.lampIntensity).toBe(0);
    splash.update(CAM, WEATHER_PRESETS.rain, LAMP_OFF, { x: 0.6, y: -0.05, z: 0 }, 0);
    expect(p.sunX).toBeCloseTo(0.3, 9);
    expect(p.sunY).toBeCloseTo(-0.025, 9);
    splash.dispose();
    map.dispose();
  });

  it("dispose takes the mesh and the material out of the scene", () => {
    const splash = createRainSplash(scene, "medium")!;
    const mat = splash.mesh.material as StandardMaterial;
    expect(scene.materials).toContain(mat);
    splash.dispose();
    expect(splash.mesh.isDisposed()).toBe(true);
    expect(scene.materials).not.toContain(mat);
  });
});

describe("the splash plugin", () => {
  function pluginFor(name: string): SplashPlugin {
    return attachSplash(new StandardMaterial(name, scene));
  }

  it("attaches once per material, as SplashPlugin, after the rain plugin's priority", () => {
    const mat = new StandardMaterial("sp1", scene);
    const first = attachSplash(mat);
    expect(attachSplash(mat)).toBe(first);
    expect(first.getClassName()).toBe("SplashPlugin");
    expect(first.priority).toBe(230);
  });

  it("declares the define, the seed attribute, the map sampler always, the uniforms on both lists, and the four hooks", () => {
    const plugin = pluginFor("sp2");
    const defines: Record<string, boolean> = { SPLASH: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines).toEqual({ SPLASH: true });
    const attrs: string[] = [];
    plugin.getAttributes(attrs, scene, undefined as never);
    expect(attrs).toEqual(["splashSeed"]);
    const samplers: string[] = [];
    plugin.getSamplers(samplers);
    expect(samplers).toEqual(["splashMapSampler"]);
    const uniforms = plugin.getUniforms();
    const names = [
      "splashTime", "splashCam", "splashRain", "splashSun", "splashLampPos", "splashLampDir", "splashLamp", "splashMapCentre",
      "splashMapExtent",
    ];
    expect(uniforms.ubo.map((u) => u.name)).toEqual(names);
    expect([...declaredUniforms(uniforms.vertex), ...declaredUniforms(uniforms.fragment)]).toEqual(names);
    expect(Object.keys(plugin.getCustomCode("vertex")!).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_POSITION"]);
    expect(Object.keys(plugin.getCustomCode("fragment")!).sort()).toEqual(["CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR", "CUSTOM_FRAGMENT_DEFINITIONS"]);
    expect(plugin.getCustomCode("other")).toBeNull();
    expect(plugin.getCustomCode("vertex")!.CUSTOM_VERTEX_DEFINITIONS).toContain("uniform sampler2D splashMapSampler;");
  });

  it("writes every uniform it declares in bindForSubMesh, and the map while one is set", () => {
    const plugin = pluginFor("sp3");
    plugin.time = 3;
    plugin.camX = 10; plugin.camY = 5; plugin.camZ = -20;
    plugin.rain = 0.5;
    plugin.sunX = 0; plugin.sunY = -0.8; plugin.sunZ = 0.6;
    plugin.lampX = 10; plugin.lampY = 5; plugin.lampZ = -20;
    plugin.lampDirX = 0; plugin.lampDirY = 0; plugin.lampDirZ = 1;
    plugin.lampIntensity = 2; plugin.lampCosHalf = 0.7;
    plugin.mapCentreX = 12; plugin.mapCentreZ = -4;
    const writes: Record<string, number[]> = {};
    const bound: unknown[] = [];
    const ubo = {
      updateFloat: (n: string, a: number) => { writes[n] = [a]; },
      updateFloat2: (n: string, a: number, b: number) => { writes[n] = [a, b]; },
      updateFloat3: (n: string, a: number, b: number, c: number) => { writes[n] = [a, b, c]; },
      setTexture: (n: string, t: unknown) => { bound.push([n, t]); },
    } as unknown as UniformBuffer;
    plugin.bindForSubMesh(ubo, scene, engine, undefined as never);
    expect(Object.keys(writes).sort()).toEqual(plugin.getUniforms().ubo.map((u) => u.name).sort());
    expect(writes).toEqual({
      splashTime: [3],
      splashCam: [10, 5, -20],
      splashRain: [0.5],
      splashSun: [0, -0.8, 0.6],
      splashLampPos: [10, 5, -20],
      splashLampDir: [0, 0, 1],
      splashLamp: [2, 0.7],
      splashMapCentre: [12, -4],
      splashMapExtent: [96],
    });
    expect(bound).toEqual([]);
    const map = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene);
    plugin.map = map;
    plugin.bindForSubMesh(ubo, scene, engine, undefined as never);
    expect(bound).toEqual([["splashMapSampler", map]]);
    const active: unknown[] = [];
    plugin.getActiveTextures(active as never);
    expect(active).toEqual([map]);
    expect(plugin.hasTexture(map)).toBe(true);
    map.dispose();
  });

  it("places each ring by its cycle's hash in the disc, on the map's height, facing the camera, and fades it by phase, cover, rain and backlight", () => {
    const plugin = pluginFor("sp4");
    const vertex = plugin.getCustomCode("vertex")!.CUSTOM_VERTEX_UPDATE_POSITION!;
    // The literals rainParams.ts carries: a 120 ms life, 300 cycles a fold, a 10 m disc, 6 to 10 cm.
    expect(vertex).toContain("float sT = splashTime / 0.12 + splashSeed.x;");
    expect(vertex).toContain("float sCycle = mod(floor(sT), 300.0);");
    expect(vertex).toContain("float sPhase = fract(sT);");
    expect(vertex).toContain("vec2 sH = splashHash(splashSeed.yz + sCycle);");
    // Uniform in area: the radius by the root of the hash.
    expect(vertex).toContain("float sR = 10.0 * sqrt(sH.x);");
    expect(vertex).toContain("float sA = 6.2831853 * sH.y;");
    // The same uv rule as the streaks', read in the vertex stage; outside the map, collapsed.
    expect(vertex).toContain("vec2 sMu = (sXZ - splashMapCentre) / splashMapExtent + 0.5;");
    expect(vertex).toContain("vec4 sMap = texture2D(splashMapSampler, sMu);");
    expect(vertex).toContain("float sIn = step(0.0, sMu.x) * step(sMu.x, 1.0) * step(0.0, sMu.y) * step(sMu.y, 1.0);");
    expect(vertex).toContain("vec3 sp = vec3(sXZ.x, sMap.r, sXZ.y);");
    expect(vertex).toContain("float sSize = mix(0.06, 0.1, splashSeed.w) * (0.5 + sPhase) * sIn;");
    expect(vertex).toContain("positionUpdated = sp + (sRight * position.x + sUp * position.y) * sSize;");
    // The sun behind the ring: the view toward it agrees with the light's travel. The lamp as the streaks'. Bounded.
    expect(vertex).toContain("float sSunT = max(dot(sView, splashSun), 0.0);");
    expect(vertex).toContain("float sLampT = splashLamp.x * sCone / (1.0 + sLampD2);");
    expect(vertex).toContain("float sBack = min(sSunT + sLampT, 1.0);");
    // Under canopy (the map's lift marks it) the canopy's transmission; on a roof or the water, all.
    expect(vertex).toContain("float sCover = mix(1.0, sMap.g, step(0.5, sMap.b));");
    expect(vertex).toContain("vSplashAlpha = (1.0 - sPhase) * sCover * splashRain * (0.5 + 0.5 * sBack) * sIn;");
    expect(vertex).toContain("vSplashPhase = sPhase;");
    expect(vertex).toContain("vSplashUv = position.xy + 0.5;");
    const fragment = plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR!;
    expect(fragment).toContain("float sD = length(vSplashUv - 0.5) * 2.0;");
    expect(fragment).toContain("float sRing = 1.0 - smoothstep(0.0, 0.15, abs(sD - (0.3 + 0.7 * vSplashPhase)));");
    expect(fragment).toContain("color.a *= sRing * vSplashAlpha;");
  });

  it("never spells a hashed preprocessor keyword in a comment, nor a semicolon in a trailing one", () => {
    const plugin = pluginFor("sp5");
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

  it("migrates to GLSL 300 es with the attribute, the sampler, the varyings and the hash intact", async () => {
    const plugin = pluginFor("sp6");
    const vert = await processInjected(
      plugin.getUniforms().vertex + plugin.getCustomCode("vertex")!.CUSTOM_VERTEX_DEFINITIONS!
        + "void main(void) {" + plugin.getCustomCode("vertex")!.CUSTOM_VERTEX_UPDATE_POSITION! + "}",
      ["SPLASH"], false,
    );
    expect(vert).toContain("in vec4 splashSeed");
    expect(vert).toContain("out float vSplashAlpha");
    expect(vert).toContain("out float vSplashPhase");
    expect(vert).toContain("out vec2 vSplashUv");
    expect(vert).toContain("uniform sampler2D splashMapSampler");
    expect(vert).toContain("vec2 splashHash(vec2 p)");
    expect(vert).toContain("vec4 sMap = texture(splashMapSampler, sMu);");
    const frag = await processInjected(
      plugin.getUniforms().fragment + plugin.getCustomCode("fragment")!.CUSTOM_FRAGMENT_DEFINITIONS!, ["SPLASH"], true,
    );
    expect(frag).toContain("in float vSplashAlpha");
    expect(frag).toContain("in float vSplashPhase");
    expect(frag).toContain("in vec2 vSplashUv");
  });
});

describe("the splash material's stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => { translators = await startTranslators(); }, timeLimit(60_000));

  it("compile through glslang and translate to WGSL with the cover map bound, fog on: the vertex stage reads the map at a fixed level", async () => {
    const gpu = webgpuProcessingEngine();
    const gpuScene = new Scene(gpu);
    try {
      new UniversalCamera("c", new Vector3(0, 2, 0), gpuScene);
      gpuScene.fogMode = Scene.FOGMODE_EXP2;
      const splash = createRainSplash(gpuScene, "high")!;
      const map = createRainMap(gpuScene, "high") as RainMap;
      splash.setMap(map);
      splash.mesh.setEnabled(true);
      const effect = await drawnEffect(splash.mesh);
      const defines = (effect as unknown as { defines: string }).defines;
      expect(defines).toContain("#define SPLASH");
      expect(effect._vertexSourceCode).toContain("splashSeed");
      expect(effect._vertexSourceCode).toContain("sMap = texture(splashMapSampler, sMu)");
      expect(effect._fragmentSourceCode).toContain("color.a *= sRing * vSplashAlpha");
      // Each stage composed as the page composes it for the first translator
      // (`shaderLookup.ts`): a stage that does not parse throws here.
      const stage = (kind: "vertex" | "fragment", code: string) =>
        translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
      const vertex = stage("vertex", effect._vertexSourceCode);
      const fragment = stage("fragment", effect._fragmentSourceCode);
      expect(vertex).toContain("splashSeed");
      expect(vertex).toContain("splashMapSampler");
      // WGSL allows no implicit-derivative sample in a vertex stage.
      expect(vertex).toMatch(/textureSampleLevel\(/);
      expect(vertex).not.toMatch(/textureSample\(/);
      expect(fragment).toContain("vSplashAlpha");
      splash.dispose();
      map.dispose();
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
