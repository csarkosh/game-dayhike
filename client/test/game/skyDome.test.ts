import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { imageProcessingFunctions } from "@babylonjs/core/Shaders/ShadersInclude/imageProcessingFunctions.js";
import { helperFunctions } from "@babylonjs/core/Shaders/ShadersInclude/helperFunctions.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { WebGL2ShaderProcessor } from "@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors.js";
import {
  bindSkyImageProcessing, createSkyDome, SKY_DOME_IMAGE_UNIFORMS, SKY_DOME_NAME, SKY_DOME_UNIFORMS, type SkyDome,
} from "../../src/game/skyDome.js";
import { luma } from "../../src/game/colour.js";
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
      "skyCurveNeutral", "skyCurvePositive", "skyCurveNegative",
      "skyInverseScreenSize", "skyVignette1", "skyVignette2", "skyVignetteOpaque",
      "skyDitherIntensity",
    ]);
    expect(SKY_DOME_UNIFORMS).toEqual(options.uniforms);
    expect(SKY_DOME_IMAGE_UNIFORMS).toEqual([
      "skyCurveNeutral", "skyCurvePositive", "skyCurveNegative",
      "skyInverseScreenSize", "skyVignette1", "skyVignette2", "skyVignetteOpaque",
      "skyDitherIntensity",
    ]);
    expect(options.samplers).toEqual(["skyTable"]);
    // Every uniform the stages declare is one the material lists, and the reverse.
    const declared = [...`${VERTEX}\n${FRAGMENT}`.matchAll(/uniform\s+(?:float|vec[234]|mat4)\s+(\w+);/g)].map((m) => m[1]);
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
    // The image's are bound at each draw instead (below).
    const set = [...Object.keys(m._floats), ...Object.keys(m._vectors3)].sort();
    expect(set).toEqual(SKY_DOME_UNIFORMS.filter((u) => u.startsWith("sky") && !SKY_DOME_IMAGE_UNIFORMS.includes(u)).sort());
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
    // The one vector: the luminance weights, Babylon's and colour.ts's luma's.
    const vectors = [...FRAGMENT.matchAll(/const vec3 (\w+) = ([^;]+);/g)].map((m) => [m[1], m[2]]);
    expect(vectors).toEqual([["SKY_LUMINANCE", "vec3(0.2126, 0.7152, 0.0722)"]]);
    expect(helperFunctions.shader).toContain("const vec3 LuminanceEncodeApprox=vec3(0.2126,0.7152,0.0722);");
    expect([luma({ r: 1, g: 0, b: 0 }), luma({ r: 0, g: 1, b: 0 }), luma({ r: 0, g: 0, b: 1 })]).toEqual([0.2126, 0.7152, 0.0722]);
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
    // main whole, the last thing in the stage: a statement added anywhere in
    // it (the curves on the capture, say, which would grade every PBR
    // material's image-based light twice) fails here.
    const main = [
      // The sky in domeRadiance's order: the slice, the deck, the night, the disc, the mist.
      "vec3 d = normalize(vSkyDir);",
      "vec3 sky = skyScale * textureLod(skyTable, skyTableUv(d, skySunDir), 0.0).rgb;",
      "sky = mix(sky, skyDeck(skyDeckZenith, d.y), skyCloud);",
      "sky += skyNight;",
      "float inDisc = step(SKY_DISC_COS, dot(d, skySunDir));",
      "sky += inDisc * mix(skyDisc, min(skyDisc, vec3(SKY_DISC_CAPTURE_MAX)), skyCapture);",
      "float h = skyMistWeight * exp(-max(d.y, 0.0) / SKY_MIST_HORIZON);",
      "sky = mix(sky, skyMistAir, h);",
      // The tone map in Babylon's order: exposure, vignette, Neutral, encode, contrast, curves, dither.
      "vec3 toned = skyNeutral(skyVignetteOf(sky * skyExposure));",
      "toned = clamp(pow(max(toned, vec3(0.0)), vec3(1.0 / 2.2)), 0.0, 1.0);",
      "toned = skyContrastOf(toned);",
      "toned = skyCurvesOf(toned);",
      "toned = skyDitherOf(toned);",
      // The capture: the linear sky, disc capped, gamma-encoded as captureEncode, never tone-mapped.
      "vec3 captured = pow(max(sky, vec3(0.0)), vec3(1.0 / 2.2));",
      "vec3 viewed = mix(sky, toned, step(0.5, skyToneMap));",
      "gl_FragColor = vec4(mix(viewed, captured, step(0.5, skyCapture)), 1.0);",
    ];
    const mainAt = FRAGMENT.indexOf("void main(void) {");
    expect(mainAt).toBeGreaterThan(-1);
    expect(FRAGMENT.slice(mainAt)).toBe(`void main(void) {\n  ${main.join("\n  ")}\n}\n`);
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

/** An effect that records the last value bound to each uniform. */
function recordingEffect(on: NullEngine) {
  const bound = new Map<string, number[]>();
  const effect = {
    getEngine: () => on,
    setFloat: (name: string, x: number) => void bound.set(name, [x]),
    setFloat2: (name: string, x: number, y: number) => void bound.set(name, [x, y]),
    setFloat4: (name: string, x: number, y: number, z: number, w: number) => void bound.set(name, [x, y, z, w]),
    setTexture: () => undefined,
  };
  return { bound, effect: effect as unknown as Effect };
}

/** A grade with every band of the curves moved, as post.ts writes one. */
function gradedCurves(): ColorCurves {
  const curves = new ColorCurves();
  curves.globalHue = 20;
  curves.globalDensity = 10;
  curves.globalSaturation = -15;
  curves.globalExposure = 5;
  curves.shadowsHue = 210;
  curves.shadowsDensity = 40;
  curves.shadowsSaturation = 30;
  curves.shadowsExposure = -10;
  curves.midtonesHue = 120;
  curves.midtonesDensity = 15;
  curves.midtonesSaturation = -20;
  curves.midtonesExposure = 8;
  curves.highlightsHue = 35;
  curves.highlightsDensity = 50;
  curves.highlightsSaturation = 25;
  curves.highlightsExposure = 12;
  return curves;
}

describe("the dome's image processing on the material path", () => {
  // Babylon's own blocks, exactly as the installed include holds them: an
  // upgrade that changes either fails here before the dome can drift.
  const BABYLON_VIGNETTE = [
    "vec2 viewportXY=gl_FragCoord.xy*vInverseScreenSize;",
    "viewportXY=viewportXY*2.0-1.0;",
    "vec3 vignetteXY1=vec3(viewportXY*vignetteSettings1.xy+vignetteSettings1.zw,1.0);",
    "float vignetteTerm=dot(vignetteXY1,vignetteXY1);",
    "float vignette=pow(vignetteTerm,vignetteSettings2.w);",
    "vec3 vignetteColor=vignetteSettings2.rgb;",
  ];
  const BABYLON_MULTIPLY = [
    "vec3 vignetteColorMultiplier=mix(vignetteColor,vec3(1,1,1),vignette);",
    "result.rgb*=vignetteColorMultiplier;",
  ] as const;
  const BABYLON_OPAQUE = "result.rgb=mix(vignetteColor,result.rgb,vignette);";
  const BABYLON_CURVES = [
    "float luma=getLuminance(result.rgb);",
    "vec2 curveMix=clamp(vec2(luma*3.0-1.5,luma*-3.0+1.5),vec2(0.0),vec2(1.0));",
    "vec4 colorCurve=vCameraColorCurveNeutral+curveMix.x*vCameraColorCurvePositive-curveMix.y*vCameraColorCurveNegative;",
    "result.rgb*=colorCurve.rgb;",
    "result.rgb=mix(vec3(luma),result.rgb,colorCurve.a);",
  ];
  const BABYLON_DITHER = [
    "float rand=getRand(gl_FragCoord.xy*vInverseScreenSize);",
    "float dither=mix(-ditherIntensity,ditherIntensity,rand);",
    "result.rgb=saturate(result.rgb+vec3(dither));",
  ] as const;
  const BABYLON_RAND = "float getRand(vec2 seed) {return fract(sin(dot(seed.xy ,vec2(12.9898,78.233)))*43758.5453);}";
  const babylon = imageProcessingFunctions.shader;

  it("are Babylon's blocks as installed, in its order: exposure, vignette, Neutral, encode, contrast, curves, dither", () => {
    expect(babylon).toContain(`#ifdef VIGNETTE
${BABYLON_VIGNETTE.join("")}
#ifdef VIGNETTEBLENDMODEMULTIPLY
${BABYLON_MULTIPLY.join("")}
#endif
#ifdef VIGNETTEBLENDMODEOPAQUE
${BABYLON_OPAQUE}
#endif
#endif`);
    expect(babylon).toContain(`#ifdef COLORCURVES
${BABYLON_CURVES.join("")}
#endif`);
    expect(babylon).toContain(`#ifdef DITHER
${BABYLON_DITHER.join("")}
#endif`);
    // The dither's random number, from the helpers every material includes.
    expect(helperFunctions.shader).toContain(`\n${BABYLON_RAND}\n`);
    expect(helperFunctions.shader).toContain("float getLuminance(vec3 color)\n{return saturate(getLuminanceUnclamped(color));}");
    expect(helperFunctions.shader).toContain("float getLuminanceUnclamped(vec3 color)\n{return dot(color,LuminanceEncodeApprox);}");
    expect(helperFunctions.shader).toContain("#define saturate(x) clamp(x,0.0,1.0)");
    const at = (text: string) => babylon.indexOf(text);
    const order = [
      "result.rgb*=exposureLinear;",
      "#ifdef VIGNETTE\n",
      "result.rgb=PBRNeutralToneMapping(result.rgb);",
      "result.rgb=toGammaSpace(result.rgb);result.rgb=saturate(result.rgb);",
      "#ifdef CONTRAST\n",
      "#ifdef COLORCURVES\n",
      "#ifdef DITHER\n",
    ];
    for (const step of order) expect(at(step), step).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i++) expect(at(order[i - 1] as string)).toBeLessThan(at(order[i] as string));
  });

  it("are carried by the dome's fragment statement for statement, under the dome's names", () => {
    const vignette = [
      "vec2 viewportXY = gl_FragCoord.xy * skyInverseScreenSize;",
      "viewportXY = viewportXY * 2.0 - 1.0;",
      "vec3 vignetteXY1 = vec3(viewportXY * skyVignette1.xy + skyVignette1.zw, 1.0);",
      "float vignetteTerm = dot(vignetteXY1, vignetteXY1);",
      "float vignette = pow(vignetteTerm, skyVignette2.w);",
      "vec3 vignetteColor = skyVignette2.rgb;",
    ];
    const multiplier = "vec3 vignetteColorMultiplier = mix(vignetteColor, vec3(1, 1, 1), vignette);";
    // Both of Babylon's blends, each made from the colour, one chosen by a uniform.
    const blends = [
      "vec3 multiplied = color * vignetteColorMultiplier;",
      "vec3 opaque = mix(vignetteColor, color, vignette);",
    ];
    const curves = [
      "float luma = skyLuminance(color);",
      "vec2 curveMix = clamp(vec2(luma * 3.0 - 1.5, luma * -3.0 + 1.5), vec2(0.0), vec2(1.0));",
      "vec4 colorCurve = skyCurveNeutral + curveMix.x * skyCurvePositive - curveMix.y * skyCurveNegative;",
      "color *= colorCurve.rgb;",
      "color = mix(vec3(luma), color, colorCurve.a);",
    ];
    const dither = [
      "float rand = skyRand(gl_FragCoord.xy * skyInverseScreenSize);",
      "float dither = mix(-skyDitherIntensity, skyDitherIntensity, rand);",
      "color = clamp(color + vec3(dither), 0.0, 1.0);",
    ];
    const rand = "return fract(sin(dot(seed.xy, vec2(12.9898, 78.233))) * 43758.5453);";
    // The dome's names put back to Babylon's, the spaces taken out.
    const names: [RegExp, string][] = [
      [/\bskyInverseScreenSize\b/g, "vInverseScreenSize"],
      [/\bskyDitherIntensity\b/g, "ditherIntensity"],
      [/\bskyRand\b/g, "getRand"],
      [/\bskyVignette1\b/g, "vignetteSettings1"],
      [/\bskyVignette2\b/g, "vignetteSettings2"],
      [/\bskyCurveNeutral\b/g, "vCameraColorCurveNeutral"],
      [/\bskyCurvePositive\b/g, "vCameraColorCurvePositive"],
      [/\bskyCurveNegative\b/g, "vCameraColorCurveNegative"],
      [/\bskyLuminance\b/g, "getLuminance"],
      [/\bcolor\b/g, "result.rgb"],
    ];
    const asBabylon = (line: string) => names.reduce((text, [from, to]) => text.replace(from, to), line).replace(/\s+/g, "");
    const squashed = (statement: string) => statement.replace(/\s+/g, "");
    expect(vignette.map(asBabylon)).toEqual(BABYLON_VIGNETTE.map(squashed));
    expect(asBabylon(multiplier)).toBe(squashed(BABYLON_MULTIPLY[0]));
    expect(curves.map(asBabylon)).toEqual(BABYLON_CURVES.map(squashed));
    // Babylon's saturate is its macro for the same clamp (pinned above).
    const unsaturated = (statement: string) => statement.replace(/saturate\((.+)\);$/, "clamp($1,0.0,1.0);");
    expect(dither.map(asBabylon)).toEqual(BABYLON_DITHER.map((line) => unsaturated(squashed(line))));
    expect(asBabylon(`float skyRand(vec2 seed) {${rand}}`)).toBe(squashed(BABYLON_RAND));
    // What a statement assigns: `a*=b` assigns a*b.
    const assigned = (statement: string) => {
      const compound = /^([\w.]+)\*=(.+)$/.exec(statement);
      return compound ? `${compound[1]}*${compound[2]}` : statement.slice(statement.indexOf("=") + 1);
    };
    expect(blends.map((line) => assigned(asBabylon(line)))).toEqual([BABYLON_MULTIPLY[1], BABYLON_OPAQUE].map((line) => assigned(squashed(line))));

    const body = (name: string, parameter = "vec3 color") => {
      const start = FRAGMENT.indexOf(`${name}(${parameter}) {`);
      expect(start, name).toBeGreaterThan(-1);
      return FRAGMENT.slice(start, FRAGMENT.indexOf("\n}\n", start));
    };
    expect(body("vec3 skyVignetteOf")).toBe(`vec3 skyVignetteOf(vec3 color) {
  ${[...vignette, multiplier, ...blends].join("\n  ")}
  return mix(multiplied, opaque, skyVignetteOpaque);`);
    expect(body("float skyLuminance")).toBe(`float skyLuminance(vec3 color) {
  return clamp(dot(color, SKY_LUMINANCE), 0.0, 1.0);`);
    expect(body("vec3 skyCurvesOf")).toBe(`vec3 skyCurvesOf(vec3 color) {
  ${curves.join("\n  ")}
  return color;`);
    expect(body("float skyRand", "vec2 seed")).toBe(`float skyRand(vec2 seed) {
  ${rand}`);
    expect(body("vec3 skyDitherOf")).toBe(`vec3 skyDitherOf(vec3 color) {
  ${dither.join("\n  ")}
  return color;`);
  });

  it("dither as Babylon seeds its dither: from the pixel's place on the frame, which the stage reads already, with no varying added", () => {
    // gl_FragCoord is the built-in the vignette reads too: the one varying is the direction.
    expect(FRAGMENT.match(/\bgl_FragCoord\b/g)).toHaveLength(2);
    expect([...FRAGMENT.matchAll(/^varying\s+\w+\s+(\w+);/gm)].map((m) => m[1])).toEqual(["vSkyDir"]);
    // The tone-mapped colour alone is dithered: the capture and the post path's sky never are.
    expect(FRAGMENT.match(/skyDitherOf\(/g)).toHaveLength(2);
    expect(FRAGMENT).toContain("toned = skyDitherOf(toned);");
  });

  it("binds the colour curves as Babylon's own binding does, under the dome's names", () => {
    const on = new NullEngine();
    try {
      const image = new ImageProcessingConfiguration();
      image.colorCurves = gradedCurves();
      image.colorCurvesEnabled = true;
      const theirs = recordingEffect(on);
      image.bind(theirs.effect);
      const ours = recordingEffect(on);
      bindSkyImageProcessing(ours.effect, image);
      expect(ours.bound.get("skyCurveNeutral")).toEqual(theirs.bound.get("vCameraColorCurveNeutral"));
      expect(ours.bound.get("skyCurvePositive")).toEqual(theirs.bound.get("vCameraColorCurvePositive"));
      expect(ours.bound.get("skyCurveNegative")).toEqual(theirs.bound.get("vCameraColorCurveNegative"));
      // Not a check of nothing: the grade moves every curve off the identity.
      expect(ours.bound.get("skyCurveNeutral")).not.toEqual([1, 1, 1, 1]);
      expect(ours.bound.get("skyCurvePositive")).not.toEqual([0, 0, 0, 0]);
      expect(ours.bound.get("skyCurveNegative")).not.toEqual([0, 0, 0, 0]);
      // Off, the curves leave the colour as it is, whatever they hold.
      image.colorCurvesEnabled = false;
      const off = recordingEffect(on);
      bindSkyImageProcessing(off.effect, image);
      expect(off.bound.get("skyCurveNeutral")).toEqual([1, 1, 1, 1]);
      expect(off.bound.get("skyCurvePositive")).toEqual([0, 0, 0, 0]);
      expect(off.bound.get("skyCurveNegative")).toEqual([0, 0, 0, 0]);
    } finally {
      on.dispose();
    }
  });

  it("binds the vignette's settings as Babylon computes them, over the render's size or the output's", () => {
    const on = new NullEngine();
    try {
      expect([on.getRenderWidth(), on.getRenderHeight()]).toEqual([512, 256]);
      const image = new ImageProcessingConfiguration();
      image.vignetteEnabled = true;
      image.vignetteWeight = 2.5;
      image.vignetteStretch = 0.4;
      image.vignetteCenterX = 0.1;
      image.vignetteCenterY = -0.2;
      image.vignetteCameraFov = 0.8;
      image.vignetteColor = new Color4(0.01, 0.02, 0.03, 0);
      const compare = () => {
        const theirs = recordingEffect(on);
        image.bind(theirs.effect);
        const ours = recordingEffect(on);
        bindSkyImageProcessing(ours.effect, image);
        expect(ours.bound.get("skyInverseScreenSize")).toEqual(theirs.bound.get("vInverseScreenSize"));
        expect(ours.bound.get("skyVignette1")).toEqual(theirs.bound.get("vignetteSettings1"));
        expect(ours.bound.get("skyVignette2")).toEqual(theirs.bound.get("vignetteSettings2"));
        return ours.bound;
      };
      const overRender = compare();
      expect(overRender.get("skyInverseScreenSize")).toEqual([1 / 512, 1 / 256]);
      // The power, and the colour as set.
      expect(overRender.get("skyVignette2")).toEqual([0.01, 0.02, 0.03, -5]);
      expect(overRender.get("skyVignetteOpaque")).toEqual([0]);
      // By hand: tan(0.4) = 0.42279322 and, times the aspect 2, 0.84558644,
      // each mixed 0.4 of the way to their geometric mean, 0.59791990, then
      // the offsets, less each scale times its centre.
      const settings = overRender.get("skyVignette1") as number[];
      expect(settings[0]).toBeCloseTo(0.74651982, 7);
      expect(settings[1]).toBeCloseTo(0.49284389, 7);
      expect(settings[2]).toBeCloseTo(-0.07465198, 7);
      expect(settings[3]).toBeCloseTo(0.09856878, 7);
      image.outputTextureWidth = 1920;
      image.outputTextureHeight = 1080;
      const overOutput = compare();
      expect(overOutput.get("skyInverseScreenSize")).toEqual([1 / 1920, 1 / 1080]);
      image.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_OPAQUE;
      expect(compare().get("skyVignetteOpaque")).toEqual([1]);
      // Off, a power of 0: the vignette is 1 everywhere and changes nothing.
      image.vignetteEnabled = false;
      const off = recordingEffect(on);
      bindSkyImageProcessing(off.effect, image);
      expect(off.bound.get("skyInverseScreenSize")).toEqual([0, 0]);
      expect(off.bound.get("skyVignette1")).toEqual([0, 0, 0, 0]);
      expect(off.bound.get("skyVignette2")).toEqual([1, 1, 1, 0]);
      expect(off.bound.get("skyVignetteOpaque")).toEqual([0]);
    } finally {
      on.dispose();
    }
  });

  it("binds the dither as Babylon does: half the intensity either way, over the screen's size it shares with the vignette", () => {
    const on = new NullEngine();
    try {
      const image = new ImageProcessingConfiguration();
      image.ditheringEnabled = true;
      // The vignette off: the dither alone still needs the screen's size.
      expect(image.vignetteEnabled).toBe(false);
      const compare = () => {
        const theirs = recordingEffect(on);
        image.bind(theirs.effect);
        const ours = recordingEffect(on);
        bindSkyImageProcessing(ours.effect, image);
        expect(ours.bound.get("skyDitherIntensity")).toEqual(theirs.bound.get("ditherIntensity"));
        expect(ours.bound.get("skyInverseScreenSize")).toEqual(theirs.bound.get("vInverseScreenSize"));
        return ours.bound;
      };
      // Babylon's default intensity, 1/255, the one the material path runs at.
      expect(image.ditheringIntensity).toBe(1 / 255);
      const resting = compare();
      expect(resting.get("skyDitherIntensity")).toEqual([1 / 510]);
      expect(resting.get("skyInverseScreenSize")).toEqual([1 / 512, 1 / 256]);
      image.ditheringIntensity = 4 / 255;
      image.outputTextureWidth = 1920;
      image.outputTextureHeight = 1080;
      const strong = compare();
      expect(strong.get("skyDitherIntensity")).toEqual([2 / 255]);
      expect(strong.get("skyInverseScreenSize")).toEqual([1 / 1920, 1 / 1080]);
      // Off, a dither of 0, whatever the intensity holds.
      image.ditheringEnabled = false;
      const off = recordingEffect(on);
      bindSkyImageProcessing(off.effect, image);
      expect(off.bound.get("skyDitherIntensity")).toEqual([0]);
      expect(off.bound.get("skyInverseScreenSize")).toEqual([0, 0]);
    } finally {
      on.dispose();
    }
  });

  it("binds them from the scene's configuration at each draw, on both paths, with no update between", async () => {
    for (const colourPath of ["material", "post"] as const) {
      const s = scene();
      dome = createSkyDome(s, colourPath);
      const effect = await drawnEffect(dome.mesh);
      const bound = new Map<string, number[]>();
      const live = effect as unknown as Effect;
      vi.spyOn(live, "setFloat").mockImplementation((name: string, x: number) => {
        bound.set(name, [x]);
        return live;
      });
      vi.spyOn(live, "setFloat2").mockImplementation((name: string, x: number, y: number) => {
        bound.set(name, [x, y]);
        return live;
      });
      vi.spyOn(live, "setFloat4").mockImplementation((name: string, x: number, y: number, z: number, w: number) => {
        bound.set(name, [x, y, z, w]);
        return live;
      });
      const draw = () => dome!.material.bindForSubMesh(Matrix.Identity(), dome!.mesh, dome!.mesh.subMeshes[0]!);
      draw();
      for (const name of SKY_DOME_IMAGE_UNIFORMS) expect(bound.has(name), `${colourPath} ${name}`).toBe(true);
      expect(bound.get("skyCurveNeutral")).toEqual([1, 1, 1, 1]);
      expect(bound.get("skyVignette2")).toEqual([1, 1, 1, 0]);
      // The grade post.ts writes on the material path, between two draws.
      const image = s.imageProcessingConfiguration;
      image.colorCurves = gradedCurves();
      image.colorCurvesEnabled = true;
      image.vignetteEnabled = true;
      image.vignetteWeight = 2.5;
      image.vignetteColor = new Color4(0.01, 0.02, 0.03, 0);
      draw();
      const theirs = recordingEffect(engine!);
      image.bind(theirs.effect);
      expect(bound.get("skyCurveNeutral")).toEqual(theirs.bound.get("vCameraColorCurveNeutral"));
      expect(bound.get("skyVignette2")).toEqual([0.01, 0.02, 0.03, -5]);
      image.vignetteWeight = 1;
      draw();
      expect(bound.get("skyVignette2")).toEqual([0.01, 0.02, 0.03, -2]);
      // The dither the material path turns on, between two draws.
      expect(bound.get("skyDitherIntensity")).toEqual([0]);
      image.ditheringEnabled = true;
      draw();
      expect(bound.get("skyDitherIntensity")).toEqual([1 / 510]);
      // The frame's exposure, the stare's dimming in it, written between two
      // draws with no update: the material path draws with it, as every
      // other material there does; the post path keeps the stage's own.
      image.exposure = 0.25;
      draw();
      expect(bound.get("skyExposure"), colourPath).toEqual(colourPath === "material" ? [0.25] : [1]);
      dome.dispose();
      dome = null;
      engine?.dispose();
      engine = null;
    }
  });

  it("binds the frame's values again at the frame's draw after a draw in the probe's pass, which shares its effect", async () => {
    const s = scene();
    dome = createSkyDome(s, "material");
    const frame = await drawnEffect(dome.mesh);
    // The probe draws the dome in a pass of its own, into a 128-texel target.
    const probe = new RenderTargetTexture("probe", 128, s);
    engine!.currentRenderPassId = probe.renderPassId;
    const probed = await drawnEffect(dome.mesh);
    // Babylon's cache hands both passes one effect: what the probe's draw
    // binds is still bound when the frame's draw comes.
    expect(probed).toBe(frame);
    const bound = new Map<string, number[]>();
    const live = frame as unknown as Effect;
    vi.spyOn(live, "setFloat").mockImplementation((name: string, x: number) => {
      bound.set(name, [x]);
      return live;
    });
    vi.spyOn(live, "setFloat2").mockImplementation((name: string, x: number, y: number) => {
      bound.set(name, [x, y]);
      return live;
    });
    vi.spyOn(live, "setFloat4").mockImplementation((name: string, x: number, y: number, z: number, w: number) => {
      bound.set(name, [x, y, z, w]);
      return live;
    });
    // Each render starts with no material cached, so the stored values go up too.
    const draw = () => {
      s.resetCachedMaterial();
      dome!.material.bindForSubMesh(Matrix.Identity(), dome!.mesh, dome!.mesh.subMeshes[0]!);
    };
    const image = s.imageProcessingConfiguration;
    image.vignetteEnabled = true;
    image.vignetteWeight = 2.5;
    image.ditheringEnabled = true;
    image.exposure = 0.25;
    // The probe's draw: its pass, its target, the capture on.
    engine!.bindFramebuffer(probe.renderTarget!);
    dome.setCapture(true);
    draw();
    dome.setCapture(false);
    engine!.unBindFramebuffer(probe.renderTarget!);
    expect(bound.get("skyInverseScreenSize")).toEqual([1 / 128, 1 / 128]);
    expect(bound.get("skyCapture")).toEqual([1]);
    const probeVignette = bound.get("skyVignette1");
    // The frame's draw, in the main pass, over the frame's 512 x 256.
    engine!.currentRenderPassId = 0;
    draw();
    const theirs = recordingEffect(engine!);
    image.bind(theirs.effect);
    expect(bound.get("skyInverseScreenSize")).toEqual([1 / 512, 1 / 256]);
    expect(bound.get("skyVignette1")).toEqual(theirs.bound.get("vignetteSettings1"));
    expect(bound.get("skyVignette1")).not.toEqual(probeVignette);
    expect(bound.get("skyCapture")).toEqual([0]);
    expect(bound.get("skyExposure")).toEqual([0.25]);
    expect(bound.get("skyDitherIntensity")).toEqual([1 / 510]);
    probe.dispose();
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
        // The vignette reads the fragment's position on the frame.
        expect(fragment).toMatch(/@builtin\(position\)/);
        expect(fragment).toContain("skyVignette1");
        expect(fragment).toContain("skyCurveNeutral");
        expect(fragment).toContain("skyDitherIntensity");
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
