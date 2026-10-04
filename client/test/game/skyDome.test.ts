import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { WebGL2ShaderProcessor } from "@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors.js";
import { createSkyDome, SKY_DOME_NAME, SKY_DOME_UNIFORMS, type SkyDome } from "../../src/game/skyDome.js";
import { rgbToHalfRgba } from "../../src/game/halfFloat.js";
import { NIGHT_SKY, sunPositionAt } from "../../src/game/sky.js";
import { SLICE_ALTITUDES_DEG, SLICE_AZIMUTHS, SLICE_ELEVATIONS } from "../../src/game/skyModel.js";
import { buildSkyTableSync, NOON_ALTITUDE_DEG, sliceBracket } from "../../src/game/skyTable.js";
import { MIST_HORIZON, SUN_DISC_CAPTURE_MAX, SUN_DISC_COS, skyStateFor } from "../../src/game/skyState.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { skyFixture } from "./helpers/skyFixture.js";
import { timeLimit } from "../helpers/timeLimit.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
/** A half's value, decoded the long way: sign, exponent and mantissa. */
function fromHalf(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 31) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const VERTEX = fx("skyDome.vertex.fx");
const FRAGMENT = fx("skyDome.fragment.fx");

/** What a ShaderMaterial holds of its options and uniform values. */
type Held = {
  _options: { attributes: string[]; uniforms: string[]; samplers: string[] };
  _floats: Record<string, number>;
  _vectors3: Record<string, Vector3>;
  _textures: Record<string, Texture>;
};
const held = (material: ShaderMaterial) => material as unknown as Held;

let engine: NullEngine | null = null;
let dome: SkyDome | null = null;
afterEach(() => {
  dome?.dispose();
  dome = null;
  engine?.dispose();
  engine = null;
});
function scene(halfFloatFiltering = false): Scene {
  engine = new NullEngine();
  engine.getCaps().textureHalfFloatLinearFiltering = halfFloatFiltering;
  const s = new Scene(engine);
  s.activeCamera = new UniversalCamera("eye", new Vector3(0, 2, 0), s);
  return s;
}

describe("createSkyDome", () => {
  it("is a box 8000 across named skyDome, riding with the eye, never picked, drawn from inside", () => {
    const s = scene();
    dome = createSkyDome(s, "post");
    expect(dome.mesh.name).toBe(SKY_DOME_NAME);
    expect(SKY_DOME_NAME).toBe("skyDome");
    expect(dome.mesh.infiniteDistance).toBe(true);
    expect(dome.mesh.isPickable).toBe(false);
    expect(dome.mesh.getBoundingInfo().boundingBox.extendSize.asArray()).toEqual([4000, 4000, 4000]);
    expect(dome.mesh.material).toBe(dome.material);
    expect(dome.material).toBeInstanceOf(ShaderMaterial);
    expect(dome.material.name).toBe(SKY_DOME_NAME);
    expect(dome.material.backFaceCulling).toBe(false);
  });

  it("stays out of the scene's fog: under it Babylon would add a fog define the stages never read", async () => {
    const gpu = webgpuProcessingEngine();
    const gpuScene = new Scene(gpu);
    try {
      gpuScene.activeCamera = new UniversalCamera("eye", new Vector3(0, 2, 0), gpuScene);
      gpuScene.fogMode = Scene.FOGMODE_EXP2;
      const made = createSkyDome(gpuScene, "post");
      expect(made.mesh.applyFog).toBe(false);
      const effect = await drawnEffect(made.mesh);
      expect((effect as unknown as { defines: string }).defines).not.toContain("FOG");
      made.dispose();
    } finally {
      gpuScene.dispose();
      gpu.dispose();
    }
  }, timeLimit(10_000));

  it("builds its material from the two stages it stores, with the position, the uniforms and the table", () => {
    const s = scene();
    dome = createSkyDome(s, "post");
    expect(Effect.ShadersStore["skyDomeVertexShader"]).toBe(VERTEX);
    expect(Effect.ShadersStore["skyDomeFragmentShader"]).toBe(FRAGMENT);
    const options = held(dome.material)._options;
    expect(options.attributes).toEqual(["position"]);
    expect(options.uniforms).toEqual([
      "world", "viewProjection",
      "skyScale", "skyCloud", "skyDeckZenith", "skyNight", "skyMistAir", "skyMistWeight", "skySunDir", "skyDisc",
      "skyCapture", "skyExposure", "skyToneMap", "skyContrast",
    ]);
    expect(SKY_DOME_UNIFORMS).toEqual(options.uniforms);
    expect(options.samplers).toEqual(["skyTable"]);
    // Every uniform the stages declare is one the material lists, and the reverse.
    const declared = [...`${VERTEX}\n${FRAGMENT}`.matchAll(/uniform\s+(?:float|vec3|mat4)\s+(\w+);/g)].map((m) => m[1]);
    expect([...declared].sort()).toEqual([...options.uniforms].sort());
    expect(FRAGMENT).toContain("uniform sampler2D skyTable;");
  });

  it("holds the table as a 32 x 64 RGBA half-float texture, clamped, filtered where the engine filters half floats", () => {
    const s = scene(true);
    dome = createSkyDome(s, "post");
    const table = held(dome.material)._textures["skyTable"]!;
    expect(table.name).toBe("skyTable");
    expect(table.getSize()).toEqual({ width: SLICE_AZIMUTHS, height: SLICE_ELEVATIONS });
    expect([SLICE_AZIMUTHS, SLICE_ELEVATIONS]).toEqual([32, 64]);
    const internal = table.getInternalTexture()!;
    expect(internal.type).toBe(Constants.TEXTURETYPE_HALF_FLOAT);
    expect(internal.format).toBe(Constants.TEXTUREFORMAT_RGBA);
    expect(internal.generateMipMaps).toBe(false);
    expect(table.wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
    expect(table.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
    expect(table.samplingMode).toBe(Texture.BILINEAR_SAMPLINGMODE);
  });

  it("starts as the night sky alone, the tone map set by the colour path", () => {
    const s = scene();
    dome = createSkyDome(s, "post");
    const post = held(dome.material);
    expect(post._floats).toEqual({
      skyScale: 0, skyCloud: 0, skyMistWeight: 0, skyCapture: 0, skyExposure: 1, skyToneMap: 0, skyContrast: 1,
    });
    expect(post._vectors3["skyNight"]!.asArray()).toEqual([NIGHT_SKY.r, NIGHT_SKY.g, NIGHT_SKY.b]);
    expect(post._vectors3["skySunDir"]!.asArray()).toEqual([0, 1, 0]);
    dome.dispose();
    dome = createSkyDome(s, "material");
    expect(held(dome.material)._floats["skyToneMap"]).toBe(1);
  });

  it("update uploads the clear slice times its scale as halves and sets every uniform of the sky from the state", () => {
    const s = scene();
    s.imageProcessingConfiguration.contrast = 1.1;
    dome = createSkyDome(s, "post");
    // Dusk in mist: cloud, mist, a disc and a deck all in play.
    const state = skyStateFor(skyFixture(), 18, WEATHER_PRESETS.mist);
    dome.update(state, 1.3);
    const table = held(dome.material)._textures["skyTable"]!;
    const uploaded = (table.getInternalTexture() as unknown as { _bufferView: Uint16Array })._bufferView;
    expect(uploaded).toBeInstanceOf(Uint16Array);
    expect(uploaded.length).toBe(32 * 64 * 4);
    expect([...uploaded]).toEqual([...rgbToHalfRgba(state.clear.texels, undefined, state.scale)]);
    const m = held(dome.material);
    expect(m._floats).toEqual({
      // The texture holds the slice already in the scene's units.
      skyScale: 1,
      skyCloud: 0.9,
      skyMistWeight: 1,
      skyCapture: 0,
      skyExposure: 1.3,
      skyToneMap: 0,
      skyContrast: 1.1,
    });
    const v = (name: string) => m._vectors3[name]!.asArray();
    expect(v("skyDeckZenith")).toEqual([state.deckZenith.r, state.deckZenith.g, state.deckZenith.b]);
    expect(v("skyNight")).toEqual([state.nightFloor.r, state.nightFloor.g, state.nightFloor.b]);
    expect(v("skyMistAir")).toEqual([state.mistAir.r, state.mistAir.g, state.mistAir.b]);
    expect(v("skySunDir")).toEqual([state.sunDir.x, state.sunDir.y, state.sunDir.z]);
    expect(v("skyDisc")).toEqual([state.discColour.r, state.discColour.g, state.discColour.b]);
    // Every sky uniform holds a value: none is left to the engine's default.
    const set = [...Object.keys(m._floats), ...Object.keys(m._vectors3)].sort();
    expect(set).toEqual(SKY_DOME_UNIFORMS.filter((u) => u.startsWith("sky")).sort());
  });

  it("update uploads from one buffer, made with the dome, refilled each time", () => {
    const s = scene();
    dome = createSkyDome(s, "post");
    const table = held(dome.material)._textures["skyTable"]!;
    const internal = table.getInternalTexture() as unknown as { _bufferView: Uint16Array };
    const made = internal._bufferView;
    const noon = skyStateFor(skyFixture(), 12, WEATHER_PRESETS.clear);
    dome.update(noon, 0.9);
    expect(internal._bufferView).toBe(made);
    expect([...made]).toEqual([...rgbToHalfRgba(noon.clear.texels, undefined, noon.scale)]);
    const dusk = skyStateFor(skyFixture(), 18, WEATHER_PRESETS.clear);
    dome.update(dusk, 1.3);
    expect(internal._bufferView).toBe(made);
    expect([...made]).toEqual([...rgbToHalfRgba(dusk.clear.texels, undefined, dusk.scale)]);
  });

  it("uploads nothing for a change of weather alone, and again for a change of hour or a slice's arrival", () => {
    const s = scene();
    dome = createSkyDome(s, "post");
    const table = held(dome.material)._textures["skyTable"]!;
    const uploads = vi.spyOn(table as unknown as { update(data: ArrayBufferView): void }, "update");
    dome.update(skyStateFor(skyFixture(), 12, WEATHER_PRESETS.clear), 0.9);
    expect(uploads).toHaveBeenCalledTimes(1);
    // The weather moves the uniforms, never the scaled slice.
    const mist = skyStateFor(skyFixture(), 12, WEATHER_PRESETS.mist);
    dome.update(mist, 0.9);
    dome.update(skyStateFor(skyFixture(), 12, WEATHER_PRESETS.rain), 0.9);
    expect(uploads).toHaveBeenCalledTimes(1);
    expect(held(dome.material)._floats["skyCloud"]).toBe(1);
    const afternoon = skyStateFor(skyFixture(), 15, WEATHER_PRESETS.clear);
    dome.update(afternoon, 0.9);
    expect(uploads).toHaveBeenCalledTimes(2);
    // The same hour after a slice has arrived: the blend may have moved.
    dome.update({ ...afternoon, tableCount: afternoon.tableCount + 1 }, 0.9);
    expect(uploads).toHaveBeenCalledTimes(3);
    expect(afternoon.tableCount).toBe(17);
  });

  it("holds the twilight in the scene's units: every texel over 1e-3 at 18:45 and 18:51 clear decodes within 1 % of texel times scale", () => {
    const hours = [18.75, 18.85];
    const indices = new Set<number>(sliceBracket(NOON_ALTITUDE_DEG));
    for (const hour of hours) for (const index of sliceBracket((Math.asin(sunPositionAt(hour).y) * 180) / Math.PI)) indices.add(index);
    const twilight = buildSkyTableSync([...indices].sort((a, b) => a - b).map((index) => SLICE_ALTITUDES_DEG[index] as number));
    const s = scene();
    dome = createSkyDome(s, "post");
    const internal = held(dome.material)._textures["skyTable"]!.getInternalTexture() as unknown as { _bufferView: Uint16Array };
    for (const hour of hours) {
      const state = skyStateFor(twilight, hour, WEATHER_PRESETS.clear);
      dome.update(state, 1.6);
      let counted = 0;
      for (let i = 0; i < SLICE_AZIMUTHS * SLICE_ELEVATIONS; i++) {
        for (let c = 0; c < 3; c++) {
          const wanted = (state.clear.texels[i * 3 + c] as number) * state.scale;
          if (!(wanted > 1e-3)) continue;
          counted++;
          expect(Math.abs(fromHalf(internal._bufferView[i * 4 + c] as number) / wanted - 1), `hour ${hour}, texel ${i}`).toBeLessThan(0.01);
        }
      }
      // Not a check of nothing: at 18:51 still over 200 channels, toward the sun.
      expect(counted, `hour ${hour}`).toBeGreaterThan(200);
    }
  });

  it("setCapture switches the capture output on and off", () => {
    const s = scene();
    dome = createSkyDome(s, "material");
    dome.setCapture(true);
    expect(held(dome.material)._floats["skyCapture"]).toBe(1);
    dome.setCapture(false);
    expect(held(dome.material)._floats["skyCapture"]).toBe(0);
  });

  it("dispose takes the mesh, the material and the table out of the scene", () => {
    const s = scene();
    const made = createSkyDome(s, "post");
    const table = held(made.material)._textures["skyTable"]!;
    expect(s.textures).toContain(table);
    made.dispose();
    expect(made.mesh.isDisposed()).toBe(true);
    expect(s.materials).not.toContain(made.material);
    expect(s.textures).not.toContain(table);
    expect(s.meshes).not.toContain(made.mesh);
  });
});

describe("the dome's stages", () => {
  it("hold the shared functions text for text", () => {
    expect(FRAGMENT).toContain(`const float SKY_PI = 3.14159265;
const float SKY_AZIMUTHS = 32.0;
const float SKY_ELEVATIONS = 64.0;
const float SKY_MIST_HORIZON = 0.08;
const float SKY_DISC_COS = 0.99998890;      // cos(0.27 degrees), lockstep with SUN_DISC_COS
const float SKY_DISC_CAPTURE_MAX = 1.0;`);
    expect(FRAGMENT).toContain(`vec2 skyTableUv(vec3 d, vec3 sunDir) {
  vec2 h = d.xz;
  vec2 s = sunDir.xz;
  float hl = length(h);
  float sl = length(s);
  float c = (hl > 1.0e-6 && sl > 1.0e-6) ? clamp(dot(h, s) / (hl * sl), -1.0, 1.0) : 1.0;
  float u = acos(c) / SKY_PI;
  float e = asin(clamp(d.y, 0.0, 1.0));
  float v = 0.5 + 0.5 * sign(e) * sqrt(abs(e) / (0.5 * SKY_PI));
  return vec2((u * (SKY_AZIMUTHS - 1.0) + 0.5) / SKY_AZIMUTHS, (v * (SKY_ELEVATIONS - 1.0) + 0.5) / SKY_ELEVATIONS);
}`);
    expect(FRAGMENT).toContain(`vec3 skyDeck(vec3 zenith, float sinE) {
  return zenith * (1.0 + 2.0 * max(sinE, 0.0)) / 3.0;
}`);
  });

  it("keep every constant in lockstep with skyState.ts and the model", () => {
    const consts = Object.fromEntries(
      [...FRAGMENT.matchAll(/const float (\w+) = ([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
    );
    expect(Object.keys(consts)).toEqual([
      "SKY_PI", "SKY_AZIMUTHS", "SKY_ELEVATIONS", "SKY_MIST_HORIZON", "SKY_DISC_COS", "SKY_DISC_CAPTURE_MAX",
      "SKY_NEUTRAL_START", "SKY_NEUTRAL_DESATURATION",
    ]);
    expect(consts["SKY_PI"]).toBe(Math.PI.toFixed(8));
    expect(consts["SKY_AZIMUTHS"]).toBe(glslFloat(SLICE_AZIMUTHS));
    expect(consts["SKY_ELEVATIONS"]).toBe(glslFloat(SLICE_ELEVATIONS));
    expect(consts["SKY_MIST_HORIZON"]).toBe(glslFloat(MIST_HORIZON));
    expect(consts["SKY_DISC_COS"]).toBe(SUN_DISC_COS.toFixed(8));
    expect(consts["SKY_DISC_CAPTURE_MAX"]).toBe(glslFloat(SUN_DISC_CAPTURE_MAX));
    // Khronos PBR Neutral's published constants, as Babylon's image processing has them.
    expect(consts["SKY_NEUTRAL_START"]).toBe("0.76");
    expect(consts["SKY_NEUTRAL_DESATURATION"]).toBe("0.15");
  });

  it("compose the dome as domeRadiance does, choosing the disc, the capture and the tone map by step and mix", () => {
    expect(VERTEX).toContain("vSkyDir = position;");
    expect(VERTEX).toContain("gl_Position = viewProjection * world * vec4(position, 1.0);");
    for (const line of [
      "vec3 d = normalize(vSkyDir);",
      "vec3 sky = skyScale * textureLod(skyTable, skyTableUv(d, skySunDir), 0.0).rgb;",
      "sky = mix(sky, skyDeck(skyDeckZenith, d.y), skyCloud);",
      "sky += skyNight;",
      "float inDisc = step(SKY_DISC_COS, dot(d, skySunDir));",
      "sky += inDisc * mix(skyDisc, min(skyDisc, vec3(SKY_DISC_CAPTURE_MAX)), skyCapture);",
      "float h = skyMistWeight * exp(-max(d.y, 0.0) / SKY_MIST_HORIZON);",
      "sky = mix(sky, skyMistAir, h);",
      "vec3 toned = skyNeutral(sky * skyExposure);",
      "toned = clamp(pow(max(toned, vec3(0.0)), vec3(1.0 / 2.2)), 0.0, 1.0);",
      "toned = skyContrastOf(toned);",
      // The capture: the linear sky, disc capped, gamma-encoded as captureEncode, never tone-mapped.
      "vec3 captured = pow(max(sky, vec3(0.0)), vec3(1.0 / 2.2));",
      "vec3 viewed = mix(sky, toned, step(0.5, skyToneMap));",
      "gl_FragColor = vec4(mix(viewed, captured, step(0.5, skyCapture)), 1.0);",
    ]) {
      expect(FRAGMENT).toContain(line);
    }
    // The steps in domeRadiance's order.
    const at = (text: string) => FRAGMENT.indexOf(text);
    expect(at("sky = mix(sky, skyDeck")).toBeLessThan(at("sky += skyNight;"));
    expect(at("sky += skyNight;")).toBeLessThan(at("float inDisc"));
    expect(at("float inDisc")).toBeLessThan(at("sky = mix(sky, skyMistAir, h);"));
    // Khronos PBR Neutral and Babylon's contrast, as its image processing has them.
    expect(FRAGMENT).toContain("float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;");
    expect(FRAGMENT).toContain("float newPeak = 1.0 - k * k / (peak + k - SKY_NEUTRAL_START);");
    expect(FRAGMENT).toContain("float g = 1.0 - 1.0 / (SKY_NEUTRAL_DESATURATION * (peak - newPeak) + 1.0);");
    expect(FRAGMENT).toContain("return peak < SKY_NEUTRAL_START ? color : compressed;");
    expect(FRAGMENT).toContain("vec3 high = c * c * (3.0 - 2.0 * c);");
  });

  it("read the table once, at level 0, with no branch anywhere", () => {
    expect(FRAGMENT.match(/textureLod\(/g)).toHaveLength(1);
    expect(FRAGMENT).not.toMatch(/\btexture(?:2D)?\s*\(/);
    expect(`${VERTEX}\n${FRAGMENT}`).not.toMatch(/\bif\s*\(/);
    expect(FRAGMENT).not.toContain("discard");
  });

  it("migrate to GLSL 300 es with the varying, the explicit-level read and the output intact", async () => {
    const processing = new NullEngine();
    try {
      const vertex = await processed(VERTEX, false, processing);
      expect(vertex).toContain("in vec3 position");
      expect(vertex).toContain("out vec3 vSkyDir");
      const fragment = await processed(FRAGMENT, true, processing);
      expect(fragment).toContain("in vec3 vSkyDir");
      expect(fragment).toContain("textureLod(skyTable, skyTableUv(d, skySunDir), 0.0)");
      expect(fragment).toContain("glFragColor = vec4(mix(viewed, captured, step(0.5, skyCapture)), 1.0);");
    } finally {
      processing.dispose();
    }
  });
});

describe("the dome's stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => { translators = await startTranslators(); }, timeLimit(60_000));

  for (const colourPath of ["post", "material"] as const) {
    it(`compile through glslang and translate to WGSL on the ${colourPath} path, reading the table at an explicit level`, async () => {
      const gpu = webgpuProcessingEngine();
      const gpuScene = new Scene(gpu);
      try {
        gpuScene.activeCamera = new UniversalCamera("eye", new Vector3(0, 2, 0), gpuScene);
        const made = createSkyDome(gpuScene, colourPath);
        const effect = await drawnEffect(made.mesh);
        const defines = (effect as unknown as { defines: string }).defines;
        const stage = (kind: "vertex" | "fragment", code: string) =>
          translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
        const vertex = stage("vertex", effect._vertexSourceCode);
        const fragment = stage("fragment", effect._fragmentSourceCode);
        expect(vertex).toContain("vSkyDir");
        expect(fragment).toContain("skyTable");
        expect(fragment).toMatch(/textureSampleLevel\(/);
        expect(fragment).not.toMatch(/textureSample\(/);
        made.dispose();
      } finally {
        gpuScene.dispose();
        gpu.dispose();
      }
    }, timeLimit(60_000));
  }
});

/** A stage as Babylon's WebGL2 processing migrates it. */
function processed(source: string, isFragment: boolean, on: NullEngine): Promise<string> {
  const options: _IProcessingOptions = {
    defines: [], indexParameters: {}, isFragment, shouldUseHighPrecisionShader: true,
    supportsUniformBuffers: true, shadersRepository: "", includesShadersStore: {},
    processor: new WebGL2ShaderProcessor(), version: "300", platformName: "WEBGL2",
    processingContext: null, isNDCHalfZRange: false, useReverseDepthBuffer: false,
  };
  return new Promise((resolve) => {
    Process(source, options, (migrated) => resolve(migrated), on);
  });
}
