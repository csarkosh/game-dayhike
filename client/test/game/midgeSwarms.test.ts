import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { imageProcessingFunctions } from "@babylonjs/core/Shaders/ShadersInclude/imageProcessingFunctions.js";
import { helperFunctions } from "@babylonjs/core/Shaders/ShadersInclude/helperFunctions.js";
import {
  createMidgeSwarms, MIDGE_ALPHA_FLOOR, MIDGE_DARK, MIDGE_FLASH_GAIN, MIDGE_FLASH_POWER, MIDGE_FLOOR_FAR, MIDGE_FLOOR_NEAR,
  MIDGE_LOBE_POWER, MIDGE_NAME, MIDGE_NEUTRAL_DESATURATION, MIDGE_NEUTRAL_START, MIDGE_SKY_GLINT, MIDGE_SKY_LOBE_POWER, MIDGE_UNIFORMS,
  type MidgeFrame, type MidgeSwarms,
} from "../../src/game/midgeSwarms.js";
import {
  MIDGE_AMPS, MIDGE_BALL_FLAT, MIDGE_CARD, MIDGE_FLASH_HZ, MIDGE_MIN_PX, MIDGE_RATES, MIDGE_SWARMS_MAX, SWARM_ROW_FLOATS,
  midgeHash, midgeOffset,
} from "../../src/game/midgeMotion.js";
import { luma } from "../../src/game/colour.js";
import { sightUnder } from "../../src/game/gradeParams.js";
import { sunPositionAt } from "../../src/game/sky.js";
import { SLICE_ALTITUDES_DEG } from "../../src/game/skyModel.js";
import { skyStateFor } from "../../src/game/skyState.js";
import { buildSkyTableSync, NOON_ALTITUDE_DEG, sliceBracket } from "../../src/game/skyTable.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const VERTEX = fx("midge.vertex.fx");
const FRAGMENT = fx("midge.fragment.fx");
const SKY_FRAGMENT = fx("skyDome.fragment.fx");

/** What a ShaderMaterial holds of its options and uniform values. */
type Held = {
  _options: { attributes: string[]; uniforms: string[]; samplers: string[] };
  _floats: Record<string, number>;
  _vectors3: Record<string, Vector3>;
  _vectors4Arrays: Record<string, Float32Array>;
};
const held = (swarms: MidgeSwarms) => swarms.mesh.material as unknown as Held;

let engine: NullEngine | null = null;
let swarms: MidgeSwarms | null = null;
afterEach(() => {
  swarms?.dispose();
  swarms = null;
  engine?.dispose();
  engine = null;
});
function scene(): Scene {
  engine = new NullEngine();
  const s = new Scene(engine);
  s.activeCamera = new UniversalCamera("eye", new Vector3(0, 2, 0), s);
  return s;
}

/** A frame with every field its own value, row 0 a ball of 40 midges at full presence. */
function frame(time: number): MidgeFrame {
  const table = new Float32Array(SWARM_ROW_FLOATS * MIDGE_SWARMS_MAX);
  table.set([4, 2.5, -6, 0.5, 0.5, 40, 1, 0, 0, 0, 17, 0], 0);
  return {
    eyeX: 1, eyeY: 2, eyeZ: 3, time,
    sunX: 0, sunY: 0.6, sunZ: 0.8, sunR: 2, sunG: 1.5, sunB: 1,
    glowR: 0.9, glowG: 0.5, glowB: 0.3,
    night: 0.25, skyLuma: 0.4, pixelAt1m: 0.0011, table,
  };
}

describe("createMidgeSwarms", () => {
  it("is one unit card named midge, blended premultiplied, out of the fog, never culled, picked or shadowed", () => {
    const s = scene();
    swarms = createMidgeSwarms(s, [4], "post");
    const mesh = swarms.mesh;
    expect(mesh.name).toBe(MIDGE_NAME);
    expect(MIDGE_NAME).toBe("midge");
    expect([...mesh.getVerticesData("position")!]).toEqual([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    expect(mesh.getIndices()).toEqual([0, 1, 2, 0, 2, 3]);
    expect(mesh.applyFog).toBe(false);
    expect(mesh.alwaysSelectAsActiveMesh).toBe(true);
    expect(mesh.doNotSyncBoundingInfo).toBe(true);
    expect(mesh.isPickable).toBe(false);
    expect(mesh.receiveShadows).toBe(false);
    const material = mesh.material as ShaderMaterial;
    expect(material).toBeInstanceOf(ShaderMaterial);
    expect(material.name).toBe(MIDGE_NAME);
    expect(material.needAlphaBlending()).toBe(true);
    expect(material.alphaMode).toBe(Constants.ALPHA_PREMULTIPLIED);
    expect(material.disableDepthWrite).toBe(true);
    expect(material.backFaceCulling).toBe(false);
  });

  it("stays out of the scene's fog: under it Babylon would add a fog define the stages never read", async () => {
    const gpu = webgpuProcessingEngine();
    const gpuScene = new Scene(gpu);
    try {
      gpuScene.activeCamera = new UniversalCamera("eye", new Vector3(0, 2, 0), gpuScene);
      gpuScene.fogMode = Scene.FOGMODE_EXP2;
      const made = createMidgeSwarms(gpuScene, [4], "post");
      const effect = await drawnEffect(made.mesh);
      expect((effect as unknown as { defines: string }).defines).not.toContain("FOG");
      made.dispose();
    } finally {
      gpuScene.dispose();
      gpu.dispose();
    }
  }, timeLimit(10_000));

  it("builds its material from the two stages it stores, with the position, the midge and the uniforms", () => {
    const s = scene();
    swarms = createMidgeSwarms(s, [4], "post");
    expect(Effect.ShadersStore["midgeVertexShader"]).toBe(VERTEX);
    expect(Effect.ShadersStore["midgeFragmentShader"]).toBe(FRAGMENT);
    const options = held(swarms)._options;
    expect(options.attributes).toEqual(["position", "midge"]);
    expect(options.uniforms).toEqual([
      "viewProjection",
      "midgeEye", "midgeTime", "midgeSun", "midgeSunLight", "midgeSkyGlow", "midgeNight", "midgeSkyLuma", "midgePixel",
      "midgeSwarms",
      "midgeExposure", "midgeToneMap", "midgeContrast",
    ]);
    expect(MIDGE_UNIFORMS).toEqual(options.uniforms);
    expect(options.samplers).toEqual([]);
    // Every uniform the stages declare is one the material lists, and the reverse.
    const declared = [...`${VERTEX}\n${FRAGMENT}`.matchAll(/uniform\s+(?:float|vec[234]|mat4)\s+(\w+)(?:\[\d+\])?;/g)].map((m) => m[1]);
    expect([...declared].sort()).toEqual([...options.uniforms].sort());
    expect(VERTEX).toContain("attribute vec2 midge;");
  });

  it("lays out one instance a slot of each row's block, its row and slot written once", () => {
    const s = scene();
    swarms = createMidgeSwarms(s, [3, 0, 2, 1], "post");
    const mesh = swarms.mesh;
    expect(mesh.thinInstanceCount).toBe(6);
    expect(mesh.isEnabled()).toBe(true);
    const midge = mesh.getVertexBuffer("midge")!;
    expect(midge.getIsInstanced()).toBe(true);
    expect(midge.getStrideSize()).toBe(2);
    expect(midge.isUpdatable()).toBe(false);
    expect(midge.getData()).toEqual(new Float32Array([0, 0, 0, 1, 0, 2, 2, 0, 2, 1, 3, 0]));
    // The matrices only count the instances: one identity each, never updated.
    const world = mesh.getVertexBuffer("world0")!;
    expect(world.isUpdatable()).toBe(false);
    const matrices = world.getData() as Float32Array;
    expect(matrices.length).toBe(96);
    expect([...matrices.subarray(80, 96)]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it("holds as many instances as the blocks add up to: 25 markers of 520 and five heads of 150 make 13,750", () => {
    const s = scene();
    const blocks = [...Array<number>(25).fill(520), ...Array<number>(5).fill(150), 0, 0];
    expect(blocks.length).toBe(32);
    swarms = createMidgeSwarms(s, blocks, "post");
    expect(swarms.mesh.thinInstanceCount).toBe(13_750);
    const midge = swarms.mesh.getVertexBuffer("midge")!.getData() as Float32Array;
    expect(midge.length).toBe(27_500);
    // The last instance is the fifth head's last slot.
    expect([...midge.subarray(27_498)]).toEqual([29, 149]);
  });

  it("draws nothing where no row has an instance", () => {
    const s = scene();
    swarms = createMidgeSwarms(s, [0, 0, 0], "post");
    expect(swarms.mesh.thinInstanceCount).toBe(0);
    expect(swarms.mesh.isEnabled()).toBe(false);
    expect(swarms.mesh.isVerticesDataPresent("midge")).toBe(false);
  });

  it("refuses more rows than the table holds", () => {
    const s = scene();
    expect(() => createMidgeSwarms(s, Array<number>(33).fill(1), "post")).toThrow("createMidgeSwarms: 33 rows, the table holds 32");
  });

  it("starts with every row empty, no count and no presence, so nothing shows before the first update, the tone map set by the colour path", () => {
    const s = scene();
    swarms = createMidgeSwarms(s, [4], "post");
    const m = held(swarms);
    expect(m._floats).toEqual({
      midgeTime: 0, midgeNight: 0, midgeSkyLuma: 0, midgePixel: 0, midgeExposure: 1, midgeToneMap: 0, midgeContrast: 1,
    });
    expect(m._vectors3["midgeEye"]!.asArray()).toEqual([0, 0, 0]);
    expect(m._vectors3["midgeSun"]!.asArray()).toEqual([0, 1, 0]);
    expect(m._vectors3["midgeSunLight"]!.asArray()).toEqual([0, 0, 0]);
    expect(m._vectors3["midgeSkyGlow"]!.asArray()).toEqual([0, 0, 0]);
    const table = m._vectors4Arrays["midgeSwarms"]!;
    expect(table.length).toBe(384);
    expect(table.every((v) => v === 0)).toBe(true);
    swarms.dispose();
    swarms = createMidgeSwarms(s, [4], "material");
    expect(held(swarms)._floats["midgeToneMap"]).toBe(1);
  });

  it("update sets every uniform from the frame, through the objects made with the midges, every time, the contrast the scene's", () => {
    const s = scene();
    s.imageProcessingConfiguration.contrast = 1.1;
    swarms = createMidgeSwarms(s, [4], "post");
    const m = held(swarms);
    swarms.update(frame(12.5));
    const eye = m._vectors3["midgeEye"];
    const sun = m._vectors3["midgeSun"];
    const sunLight = m._vectors3["midgeSunLight"];
    const skyGlow = m._vectors3["midgeSkyGlow"];
    const table = m._vectors4Arrays["midgeSwarms"];
    // The exposure stands until a draw binds the frame's (below).
    expect(m._floats).toEqual({
      midgeTime: 12.5, midgeNight: 0.25, midgeSkyLuma: 0.4, midgePixel: 0.0011, midgeExposure: 1, midgeToneMap: 0, midgeContrast: 1.1,
    });
    expect(eye!.asArray()).toEqual([1, 2, 3]);
    expect(sun!.asArray()).toEqual([0, 0.6, 0.8]);
    expect(sunLight!.asArray()).toEqual([2, 1.5, 1]);
    expect(skyGlow!.asArray()).toEqual([0.9, 0.5, 0.3]);
    expect([...table!.subarray(0, 12)]).toEqual([4, 2.5, -6, 0.5, 0.5, 40, 1, 0, 0, 0, 17, 0]);

    const next = frame(13);
    next.eyeX = 7;
    next.glowR = 0.2;
    next.table[5] = 25;
    swarms.update(next);
    // The same objects, refilled: nothing is made per frame.
    expect(m._vectors3["midgeEye"]).toBe(eye);
    expect(m._vectors3["midgeSun"]).toBe(sun);
    expect(m._vectors3["midgeSunLight"]).toBe(sunLight);
    expect(m._vectors3["midgeSkyGlow"]).toBe(skyGlow);
    expect(m._vectors4Arrays["midgeSwarms"]).toBe(table);
    // Its own table, a copy of the frame's.
    expect(table).not.toBe(next.table);
    expect(m._floats["midgeTime"]).toBe(13);
    expect(eye!.asArray()).toEqual([7, 2, 3]);
    expect(skyGlow!.asArray()).toEqual([0.2, 0.5, 0.3]);
    expect(table![5]).toBe(25);
  });

  it("binds the frame's exposure at each draw on the material path, the stare's dimming in it; the post path keeps the stage's own", async () => {
    for (const colourPath of ["material", "post"] as const) {
      const s = scene();
      swarms = createMidgeSwarms(s, [4], colourPath);
      const mesh = swarms.mesh;
      const live = (await drawnEffect(mesh)) as unknown as Effect;
      const bound = new Map<string, number>();
      vi.spyOn(live, "setFloat").mockImplementation((name: string, x: number) => {
        bound.set(name, x);
        return live;
      });
      const draw = () => (mesh.material as ShaderMaterial).bindForSubMesh(Matrix.Identity(), mesh, mesh.subMeshes[0]!);
      // The frame's exposure at a quarter past six under a clear sky.
      const image = s.imageProcessingConfiguration;
      image.exposure = 1.27;
      draw();
      expect(bound.get("midgeExposure"), colourPath).toBe(colourPath === "material" ? 1.27 : 1);
      // The stare at its fullest, written between two draws with no update,
      // as the lighting writes it: the material path draws with it, as every
      // other material there does; the post path's grade dims the frame whole.
      expect(sightUnder(1)).toBe(0.7);
      image.exposure = 1.27 * sightUnder(1);
      draw();
      expect(bound.get("midgeExposure"), colourPath).toBeCloseTo(colourPath === "material" ? 0.889 : 1, 12);
      swarms.dispose();
      swarms = null;
      engine?.dispose();
      engine = null;
    }
  });

  it("dispose takes the mesh and the material out of the scene", () => {
    const s = scene();
    const made = createMidgeSwarms(s, [4, 2], "post");
    const material = made.mesh.material!;
    expect(s.meshes).toContain(made.mesh);
    expect(s.materials).toContain(material);
    made.dispose();
    expect(made.mesh.isDisposed()).toBe(true);
    expect(s.meshes).not.toContain(made.mesh);
    expect(s.materials).not.toContain(material);
  });
});

/** The vertex stage's hash, transcribed from its text (pinned below). */
const fract = (x: number): number => x - Math.floor(x);
function stageHash(i: number, s: number): number {
  const [x, y, z] = [fract(i * 0.1031), fract(s * 0.1031), fract((i + s) * 0.1031)];
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  return fract((x + d + (y + d)) * (z + d));
}

describe("the midges' stages", () => {
  const consts = Object.fromEntries(
    [...`${VERTEX}\n${FRAGMENT}`.matchAll(/const float (\w+) = ([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
  );
  const c = (name: string): number => Number(consts[name]);

  it("keep every constant in lockstep with midgeMotion.ts and midgeSwarms.ts", () => {
    expect(consts).toEqual({
      MIDGE_TAU: "6.28318531",
      MIDGE_RATE_0: "0.7", MIDGE_RATE_1: "1.3", MIDGE_RATE_2: "2.1",
      MIDGE_AMP_0: "0.55", MIDGE_AMP_1: "0.3", MIDGE_AMP_2: "0.15",
      MIDGE_BALL_FLAT: "0.6666666666666666",
      MIDGE_CARD: "0.003", MIDGE_MIN_PX: "2.0", MIDGE_ALPHA_FLOOR: "0.6",
      MIDGE_FLOOR_NEAR: "6.0", MIDGE_FLOOR_FAR: "15.0",
      MIDGE_FLASH_LOW: "9.0", MIDGE_FLASH_HIGH: "14.0",
      MIDGE_LOBE_POWER: "8.0", MIDGE_FLASH_POWER: "24.0", MIDGE_FLASH_GAIN: "0.5",
      MIDGE_SKY_GLINT: "0.6", MIDGE_SKY_LOBE_POWER: "2.0",
      MIDGE_DARK: "0.9",
      MIDGE_NEUTRAL_START: "0.76", MIDGE_NEUTRAL_DESATURATION: "0.15",
    });
    expect([MIDGE_CARD, MIDGE_MIN_PX, MIDGE_ALPHA_FLOOR, MIDGE_FLOOR_NEAR, MIDGE_FLOOR_FAR, MIDGE_SKY_GLINT, MIDGE_SKY_LOBE_POWER, MIDGE_DARK])
      .toEqual([0.003, 2, 0.6, 6, 15, 0.6, 2, 0.9]);
    expect(consts["MIDGE_TAU"]).toBe((2 * Math.PI).toFixed(8));
    MIDGE_RATES.forEach((rate, k) => expect(consts[`MIDGE_RATE_${k}`]).toBe(glslFloat(rate)));
    MIDGE_AMPS.forEach((amp, k) => expect(consts[`MIDGE_AMP_${k}`]).toBe(glslFloat(amp)));
    expect(consts["MIDGE_BALL_FLAT"]).toBe(glslFloat(MIDGE_BALL_FLAT));
    expect(consts["MIDGE_CARD"]).toBe(glslFloat(MIDGE_CARD));
    expect(consts["MIDGE_MIN_PX"]).toBe(glslFloat(MIDGE_MIN_PX));
    expect(consts["MIDGE_ALPHA_FLOOR"]).toBe(glslFloat(MIDGE_ALPHA_FLOOR));
    expect(consts["MIDGE_FLOOR_NEAR"]).toBe(glslFloat(MIDGE_FLOOR_NEAR));
    expect(consts["MIDGE_FLOOR_FAR"]).toBe(glslFloat(MIDGE_FLOOR_FAR));
    expect(consts["MIDGE_FLASH_LOW"]).toBe(glslFloat(MIDGE_FLASH_HZ[0]));
    expect(consts["MIDGE_FLASH_HIGH"]).toBe(glslFloat(MIDGE_FLASH_HZ[1]));
    expect(consts["MIDGE_LOBE_POWER"]).toBe(glslFloat(MIDGE_LOBE_POWER));
    expect(consts["MIDGE_FLASH_POWER"]).toBe(glslFloat(MIDGE_FLASH_POWER));
    expect(consts["MIDGE_FLASH_GAIN"]).toBe(glslFloat(MIDGE_FLASH_GAIN));
    expect(consts["MIDGE_SKY_GLINT"]).toBe(glslFloat(MIDGE_SKY_GLINT));
    expect(consts["MIDGE_SKY_LOBE_POWER"]).toBe(glslFloat(MIDGE_SKY_LOBE_POWER));
    expect(consts["MIDGE_DARK"]).toBe(glslFloat(MIDGE_DARK));
    // Khronos PBR Neutral's published constants: the dome's, and Babylon's as installed.
    expect([MIDGE_NEUTRAL_START, MIDGE_NEUTRAL_DESATURATION]).toEqual([0.76, 0.15]);
    expect(consts["MIDGE_NEUTRAL_START"]).toBe(glslFloat(MIDGE_NEUTRAL_START));
    expect(consts["MIDGE_NEUTRAL_DESATURATION"]).toBe(glslFloat(MIDGE_NEUTRAL_DESATURATION));
    expect(SKY_FRAGMENT).toContain("const float SKY_NEUTRAL_START = 0.76;");
    expect(SKY_FRAGMENT).toContain("const float SKY_NEUTRAL_DESATURATION = 0.15;");
    expect(imageProcessingFunctions.shader).toContain("const float PBRNeutralStartCompression=0.8-0.04;const float PBRNeutralDesaturation=0.15;");
  });

  it("hold the table as three vec4 a swarm, a row for every swarm the table holds", () => {
    expect(VERTEX).toContain("uniform vec4 midgeSwarms[96];");
    expect((MIDGE_SWARMS_MAX * SWARM_ROW_FLOATS) / 4).toBe(96);
    expect(VERTEX).toContain("int at = 3 * int(midge.x + 0.5);");
    expect(VERTEX).toContain("vec4 place = midgeSwarms[at];");
    expect(VERTEX).toContain("vec4 shape = midgeSwarms[at + 1];");
    expect(VERTEX).toContain("vec4 turn = midgeSwarms[at + 2];");
  });

  it("hash and place a midge as midgeHash and midgeOffset do", () => {
    expect(VERTEX).toContain(`float midgeHash(float i, float s) {
  vec3 p = fract(vec3(i, s, i + s) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}`);
    expect(VERTEX).toContain(`float midgeAxis(float slot, float seed, float axis, float t) {
  float base = seed + 3.0 * axis;
  float s = MIDGE_AMP_0 * sin(MIDGE_TAU * MIDGE_RATE_0 * (0.85 + 0.3 * midgeHash(slot, base + 11.0)) * t + MIDGE_TAU * midgeHash(slot, base + 41.0));
  s += MIDGE_AMP_1 * sin(MIDGE_TAU * MIDGE_RATE_1 * (0.85 + 0.3 * midgeHash(slot, base + 12.0)) * t + MIDGE_TAU * midgeHash(slot, base + 42.0));
  s += MIDGE_AMP_2 * sin(MIDGE_TAU * MIDGE_RATE_2 * (0.85 + 0.3 * midgeHash(slot, base + 13.0)) * t + MIDGE_TAU * midgeHash(slot, base + 43.0));
  return s;
}`);
    expect(VERTEX).toContain(`  vec2 across = place.w * vec2(midgeAxis(slot, seed, 0.0, t), midgeAxis(slot, seed, 2.0, t));
  float up = mix(place.w * MIDGE_BALL_FLAT, shape.x, shape.w) * midgeAxis(slot, seed, 1.0, t) * (1.0 - turn.y);
  float c = cos(turn.x);
  float n = sin(turn.x);
  vec3 centre = place.xyz + vec3(across.x * c - across.y * n, up, across.x * n + across.y * c);`);
    // The stage's hash, transcribed, is midgeMotion's.
    expect(stageHash(3, 17)).toBeCloseTo(0.724029424501623, 12);
    expect(stageHash(519, 4168)).toBeCloseTo(0.7610033564178593, 12);
    expect(midgeHash(3, 17)).toBeCloseTo(0.724029424501623, 9);
    expect(midgeHash(519, 4168)).toBeCloseTo(0.7610033564178593, 9);
    // The stage's path, transcribed with its own constants, is midgeOffset's.
    const axis = (slot: number, seed: number, a: number, t: number): number => {
      const base = seed + 3 * a;
      let s = 0;
      for (let k = 0; k < 3; k++) {
        const rate = c(`MIDGE_RATE_${k}`) * (0.85 + 0.3 * stageHash(slot, base + 11 + k));
        s += c(`MIDGE_AMP_${k}`) * Math.sin(c("MIDGE_TAU") * rate * t + c("MIDGE_TAU") * stageHash(slot, base + 41 + k));
      }
      return s;
    };
    const out = { x: 0, y: 0, z: 0 };
    for (const [slot, seed, t, radius, height, column, swirl, flatten] of [
      [0, 17, 3.25, 0.5, 0.5, false, 0, 0],
      [211, 2048, 37.5, 0.62, 1.4, true, 2.1, 0.3],
      [399, 4095, 61, 0.78, 1.5, true, -0.7, 0.5],
    ] as const) {
      midgeOffset(slot, seed, t, radius, height, column, swirl, flatten, out);
      const ax = radius * axis(slot, seed, 0, t);
      const az = radius * axis(slot, seed, 2, t);
      const up = (column ? height : radius * c("MIDGE_BALL_FLAT")) * axis(slot, seed, 1, t) * (1 - flatten);
      expect(ax * Math.cos(swirl) - az * Math.sin(swirl)).toBeCloseTo(out.x, 5);
      expect(up).toBeCloseTo(out.y, 5);
      expect(ax * Math.sin(swirl) + az * Math.cos(swirl)).toBeCloseTo(out.z, 5);
    }
  });

  it("size the card, collapse a midge by step and glint, reading no texture and branching nowhere", () => {
    expect(VERTEX).toContain("float size = max(MIDGE_CARD, MIDGE_MIN_PX * midgePixel * far);");
    expect(VERTEX).toContain("float alive = (1.0 - step(shape.y, slot)) * (1.0 - step(shape.z, 0.0));");
    expect(VERTEX).toContain("vec3 corner = centre + (side * position.x + rise * position.y) * size * alive;");
    expect(VERTEX).toContain(
      "float nearFloor = MIDGE_ALPHA_FLOOR * clamp((MIDGE_FLOOR_FAR - far) / (MIDGE_FLOOR_FAR - MIDGE_FLOOR_NEAR), 0.0, 1.0);",
    );
    expect(VERTEX).toContain("vAlpha = max(MIDGE_CARD / size, nearFloor) * shape.z * alive;");
    expect(VERTEX).toContain("float lobe = pow(max(dot(-view, midgeSun), 0.0), MIDGE_LOBE_POWER);");
    expect(VERTEX).toContain("float rate = mix(MIDGE_FLASH_LOW, MIDGE_FLASH_HIGH, midgeHash(slot, seed + 73.0));");
    expect(VERTEX).toContain(
      "float flash = pow(max(sin(MIDGE_TAU * rate * t + MIDGE_TAU * midgeHash(slot, seed + 71.0)), 0.0), MIDGE_FLASH_POWER);",
    );
    expect(VERTEX).toContain("vSunGlint = lobe + MIDGE_FLASH_GAIN * flash;");
    expect(VERTEX).toContain(`  vec3 sunLevel = vec3(midgeSun.x, 0.0, midgeSun.z);
  vec3 sunFlat = normalize(mix(vec3(1.0, 0.0, 0.0), sunLevel, step(1.0e-8, dot(sunLevel, sunLevel))));
  vSkyGlint = MIDGE_SKY_GLINT * pow(max(dot(-view, sunFlat), 0.0), MIDGE_SKY_LOBE_POWER);`);
    // The fragment's main whole, the last thing in the stage: the glint times
    // its coverage, then on the material path toned in Babylon's order
    // (exposure, Neutral, encode, contrast), chosen by step on the colour
    // path's uniform; the coverage's alpha never toned.
    const main = [
      "vec2 tent = clamp(1.0 - abs(vCorner), 0.0, 1.0);",
      "float a = vAlpha * tent.x * tent.y;",
      "float day = 1.0 - midgeNight;",
      "vec3 sunGlint = midgeSunLight * day * vSunGlint;",
      "vec3 skyGlint = midgeSkyGlow * vSkyGlint;",
      "float speck = MIDGE_DARK * clamp(midgeSkyLuma, 0.0, 1.0);",
      "vec3 light = (sunGlint + skyGlint) * a;",
      "vec3 toned = midgeNeutral(light * midgeExposure);",
      "toned = clamp(pow(max(toned, vec3(0.0)), vec3(1.0 / 2.2)), 0.0, 1.0);",
      "toned = midgeContrastOf(toned);",
      "gl_FragColor = vec4(mix(light, toned, step(0.5, midgeToneMap)), speck * a);",
    ];
    const mainAt = FRAGMENT.indexOf("void main(void) {");
    expect(mainAt).toBeGreaterThan(-1);
    expect(FRAGMENT.slice(mainAt)).toBe(`void main(void) {\n  ${main.join("\n  ")}\n}\n`);
    const both = `${VERTEX}\n${FRAGMENT}`;
    expect(both).not.toMatch(/\btexture\w*\s*\(/);
    expect(both).not.toMatch(/sampler/);
    expect(both).not.toMatch(/\bif\s*\(/);
    expect(both).not.toMatch(/\?/);
    expect(both).not.toContain("discard");
  });

  /** The vertex stage's coverage, transcribed from its pinned lines: the card
   * `far` metres from the eye, a pixel `pixel` metres across at 1 m. */
  const coverage = (far: number, pixel: number, presence: number): number => {
    const size = Math.max(c("MIDGE_CARD"), c("MIDGE_MIN_PX") * pixel * far);
    const fade = Math.min(Math.max((c("MIDGE_FLOOR_FAR") - far) / (c("MIDGE_FLOOR_FAR") - c("MIDGE_FLOOR_NEAR")), 0), 1);
    return Math.max(c("MIDGE_CARD") / size, c("MIDGE_ALPHA_FLOOR") * fade) * presence;
  };

  it("hold a near midge's coverage at the floor, a dot not a ghost, and let a far one fade to a faint speck", () => {
    // 1100 pixels to a metre at 1 m: within 1.36 m the card covers 2 px or
    // more and keeps its whole coverage.
    expect(coverage(1, 0.0011, 1)).toBe(1);
    // Enlarged to 2 px, it covers 0.68 of them at 2 m, and the floor holds it
    // at 0.6 from 2.27 m out to 6 m.
    expect(coverage(2, 0.0011, 1)).toBeCloseTo(0.681818, 6);
    expect(coverage(2.27272727, 0.0011, 1)).toBeCloseTo(0.6, 6);
    expect(coverage(3, 0.0011, 1)).toBe(0.6);
    expect(coverage(6, 0.0011, 1)).toBe(0.6);
    // From 6 m to 15 m the floor falls to nothing: half of it at 10.5 m, above
    // the card's own 0.13 there.
    expect(coverage(10.5, 0.0011, 1)).toBeCloseTo(0.3, 12);
    // From 15 m out the card keeps only its own coverage of its 2 px: 0.091 at
    // 15 m, 0.068 at 20 m, 0.023 at 60 m. A swarm across the lake is faint
    // specks, not a solid blob.
    expect(coverage(15, 0.0011, 1)).toBeCloseTo(0.0909091, 6);
    expect(coverage(20, 0.0011, 1)).toBeCloseTo(0.0681818, 6);
    expect(coverage(60, 0.0011, 1)).toBeCloseTo(0.0227273, 6);
    // Still scaled by the swarm's presence.
    expect(coverage(3, 0.0011, 0.5)).toBe(0.3);
    expect(coverage(20, 0.0011, 0.5)).toBeCloseTo(0.0340909, 6);
    expect(coverage(20, 0.0011, 0)).toBe(0);
  });

  /** The fragment stage's footprint, transcribed from its pinned lines: u and v
   * run -1 to 1 across the card. */
  const tent = (u: number, v: number): number =>
    Math.min(Math.max(1 - Math.abs(u), 0), 1) * Math.min(Math.max(1 - Math.abs(v), 0), 1);
  /** The footprint summed over the pixel centres a midge at (x, y), in pixels,
   * covers at its fewest pixels across, its card square to the screen as it is
   * on the view axis. */
  const pixelSum = (x: number, y: number, footprint: (u: number, v: number) => number): number => {
    const half = c("MIDGE_MIN_PX") / 2;
    let sum = 0;
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) sum += footprint((i + 0.5 - x) / half, (j + 0.5 - y) / half);
    }
    return sum;
  };

  it("lay a tent on the card whose pixel centres sum the same wherever a far midge lies on the view axis", () => {
    expect(tent(0, 0)).toBe(1);
    expect(tent(0.5, 0)).toBe(0.5);
    expect(tent(0.5, -0.5)).toBe(0.25);
    expect(tent(1, 0.2)).toBe(0);
    for (const [x, y] of [[0, 0], [0.5, 0.5], [0.25, 0.1], [0.77, 0.31], [-0.4, 0.9]] as const) {
      expect(pixelSum(x, y, tent), `(${x}, ${y})`).toBeCloseTo(1, 12);
    }
    // The disc it replaced summed 1 on a pixel's centre and 2 on its corner:
    // a far midge flickered as it crossed the pixels.
    const disc = (u: number, v: number): number => Math.min(Math.max(1 - (u * u + v * v), 0), 1);
    expect(pixelSum(0.5, 0.5, disc)).toBeCloseTo(1, 12);
    expect(pixelSum(0, 0, disc)).toBeCloseTo(2, 12);
  });

  /** The vertex stage's sky glint, transcribed from its pinned lines: `look` the
   * direction from the eye to the midge, `sun` toward the sun. */
  const skyGlint = (look: readonly [number, number, number], sun: readonly [number, number, number]): number => {
    const level = [sun[0], 0, sun[2]] as const;
    const length2 = level[0] * level[0] + level[2] * level[2];
    const flat = length2 >= 1e-8 ? [level[0], 0, level[2]] : [1, 0, 0];
    const n = Math.hypot(flat[0]!, flat[1]!, flat[2]!);
    const d = (look[0] * flat[0]! + look[1] * flat[1]! + look[2] * flat[2]!) / n;
    return c("MIDGE_SKY_GLINT") * Math.pow(Math.max(d, 0), c("MIDGE_SKY_LOBE_POWER"));
  };
  /** The fragment stage's colour before the coverage, from its pinned lines. */
  const glintColour = (
    sunLight: readonly [number, number, number], skyGlow: readonly [number, number, number], night: number,
    sunGlint: number, sky: number,
  ): number[] => [0, 1, 2].map((i) => sunLight[i]! * (1 - night) * sunGlint + skyGlow[i]! * sky);

  it("glint with the sky toward the sun's azimuth after sunset, and not away from it", () => {
    // The sun 7 degrees under the horizon in the west-south-west.
    const sun = [-0.962, -0.127, -0.243] as const;
    const toward = (up: number, turn: number): [number, number, number] => {
      const az = Math.atan2(-0.243, -0.962) + turn;
      return [Math.cos(up) * Math.cos(az), Math.sin(up), Math.cos(up) * Math.sin(az)];
    };
    // Level toward the sun's azimuth: the whole of it, though the sun is down.
    expect(skyGlint(toward(0, 0), sun)).toBeCloseTo(0.6, 12);
    // Thirty degrees up, or sixty to the side: three quarters, and a quarter.
    expect(skyGlint(toward(Math.PI / 6, 0), sun)).toBeCloseTo(0.45, 12);
    expect(skyGlint(toward(0, Math.PI / 3), sun)).toBeCloseTo(0.15, 12);
    // Square to it, and away: none.
    expect(skyGlint(toward(0, Math.PI / 2), sun)).toBeCloseTo(0, 12);
    expect(skyGlint(toward(0, Math.PI), sun)).toBe(0);
    expect(skyGlint(toward(-0.3, 2.5), sun)).toBe(0);
    // The sun straight overhead has no azimuth: the level falls back to +x, never NaN.
    expect(skyGlint([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.6, 12);
    expect(skyGlint([-1, 0, 0], [0, 1, 0])).toBe(0);
    // In the fragment, the sky's share takes the horizon's colour toward the
    // sun, the sun's its own light (none once it has set). The sun's is gone
    // at night; the sky's is not cut by the night factor, its colour fades
    // with the twilight by itself.
    const glow = [0.9, 0.5, 0.3] as const;
    const set = [0, 0, 0] as const;
    const g = skyGlint(toward(0, 0), sun);
    glintColour(set, glow, 0.25, 0.8, g).forEach((v, i) => expect(v).toBeCloseTo([0.54, 0.3, 0.18][i]!, 12));
    glintColour(set, glow, 1, 0.8, g).forEach((v, i) => expect(v).toBeCloseTo([0.54, 0.3, 0.18][i]!, 12));
    glintColour([2, 1.5, 1], glow, 0, 0.5, 0).forEach((v, i) => expect(v).toBeCloseTo([1, 0.75, 0.5][i]!, 12));
    expect(glintColour([2, 1.5, 1], [0, 0, 0], 1, 0.5, 0)).toEqual([0, 0, 0]);
  });

  it("keep the sky's glint through the swarms' full hour after sunset, fading with the twilight by night", () => {
    // A sky of its own: the slices that bracket noon and the sun at 18:45 and
    // at 22:00, so each state is the sky's own, not its neighbours' stand-in.
    const altitudeAt = (hour: number): number => (Math.asin(sunPositionAt(hour).y) * 180) / Math.PI;
    const indices = new Set([NOON_ALTITUDE_DEG, altitudeAt(18.75), altitudeAt(22)].flatMap(sliceBracket));
    const table = buildSkyTableSync([...indices].sort((a, b) => a - b).map((i) => SLICE_ALTITUDES_DEG[i]!));
    expect(table.count).toBe(5);
    /** The glint's colour, before the coverage, of a midge seen level toward
     * the sun's azimuth at `hour` under a clear sky, the frame filled as
     * waterLife.ts fills it: the sun's light, the horizon toward the sun
     * blended toward the mist's air (none under a clear sky). */
    const at = (hour: number): { night: number; colour: number[] } => {
      const sky = skyStateFor(table, hour, WEATHER_PRESETS.clear);
      expect(table.has((sky.altitude * 180) / Math.PI), `${hour}`).toBe(true);
      const d = sky.sunDir;
      const level = Math.hypot(d.x, d.z);
      const look = [d.x / level, 0, d.z / level] as const;
      const sunLight = [sky.sunColour.r * sky.sunIntensity, sky.sunColour.g * sky.sunIntensity, sky.sunColour.b * sky.sunIntensity] as const;
      const h = sky.horizonToward, air = sky.mistAir, mist = sky.mistWeight;
      const glow = [h.r + (air.r - h.r) * mist, h.g + (air.g - h.g) * mist, h.b + (air.b - h.b) * mist] as const;
      return { night: sky.night, colour: glintColour(sunLight, glow, sky.night, 1, skyGlint(look, [d.x, d.y, d.z])) };
    };
    // 18:45: full night by the sky's own factor and the sun gives nothing, yet
    // the western horizon still glows red, and the midges with it.
    const dusk = at(18.75);
    expect(dusk.night).toBe(1);
    dusk.colour.forEach((v, i) => expect(v).toBeCloseTo([0.173467, 0.035212, 0.038471][i]!, 6));
    const duskLuma = luma({ r: dusk.colour[0]!, g: dusk.colour[1]!, b: dusk.colour[2]! });
    expect(duskLuma).toBeCloseTo(0.06484, 5);
    // 22:00: the twilight gone, only the night sky's own floor toward the
    // west, under a third of the glint at 18:45 and none of its red.
    const night = at(22);
    expect(night.night).toBe(1);
    night.colour.forEach((v, i) => expect(v).toBeCloseTo([0.012149, 0.018012, 0.036][i]!, 6));
    expect(luma({ r: night.colour[0]!, g: night.colour[1]!, b: night.colour[2]! })).toBeCloseTo(0.018064, 6);
  }, timeLimit(10_000));

  const mix = (x: number, y: number, t: number): number => x * (1 - t) + y * t;
  const step = (edge: number, x: number): number => (x < edge ? 0 : 1);
  /** Babylon's Khronos PBR Neutral, transcribed from its installed text (pinned below), its early return kept. */
  const babylonNeutral = (rgb: readonly number[]): number[] => {
    const start = 0.8 - 0.04;
    const x = Math.min(rgb[0]!, rgb[1]!, rgb[2]!);
    const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    const color = rgb.map((v) => v - offset);
    const peak = Math.max(...color);
    if (peak < start) return color;
    const d = 1 - start;
    const newPeak = 1 - (d * d) / (peak + d - start);
    const g = 1 - 1 / (0.15 * (peak - newPeak) + 1);
    return color.map((v) => mix(v * (newPeak / peak), newPeak, g));
  };
  /** The fragment stage's Neutral, transcribed from its pinned lines. */
  const stageNeutral = (rgb: readonly number[]): number[] => {
    const start = c("MIDGE_NEUTRAL_START");
    const x = Math.min(rgb[0]!, rgb[1]!, rgb[2]!);
    const offset = mix(x - 6.25 * x * x, 0.04, step(0.08, x));
    const color = rgb.map((v) => v - offset);
    const peak = Math.max(...color);
    const top = Math.max(peak, start);
    const k = 1 - start;
    const newPeak = 1 - (k * k) / (top + k - start);
    const g = 1 - 1 / (c("MIDGE_NEUTRAL_DESATURATION") * (top - newPeak) + 1);
    return color.map((v) => mix(v, mix(v * (newPeak / top), newPeak, g), step(start, peak)));
  };
  /** The fragment stage's colour, transcribed from its pinned lines: `light`
   * the glint times its coverage, then the tail by the colour path's uniform. */
  const stageColour = (light: readonly number[], exposure: number, toneMap: number, contrast: number): number[] => {
    const encoded = stageNeutral(light.map((v) => v * exposure)).map((v) => Math.min(Math.max(Math.pow(Math.max(v, 0), 1 / 2.2), 0), 1));
    const toned = encoded.map((v) => {
      const high = v * v * (3 - 2 * v);
      return Math.max(mix(mix(0.5, v, contrast), mix(v, high, contrast - 1), step(1, contrast)), 0);
    });
    return light.map((v, i) => mix(v, toned[i]!, step(0.5, toneMap)));
  };

  it("tone the glint on the material path as Babylon's image processing tones every other material there, and leave it as it was on the post path", () => {
    // Babylon's blocks as installed: an upgrade that changes one fails here
    // before the midges can drift from the frame they land in.
    const babylon = imageProcessingFunctions.shader;
    expect(babylon).toContain(
      "float x=min(color.r,min(color.g,color.b));float offset=x<0.08 ? x-6.25*x*x : 0.04;color-=offset;" +
        "float peak=max(color.r,max(color.g,color.b));if (peak<PBRNeutralStartCompression) return color;" +
        "float d=1.-PBRNeutralStartCompression;float newPeak=1.-d*d/(peak+d-PBRNeutralStartCompression);color*=newPeak/peak;" +
        "float g=1.-1./(PBRNeutralDesaturation*(peak-newPeak)+1.);return mix(color,newPeak*vec3(1,1,1),g);}",
    );
    expect(babylon).toContain("result.rgb=toGammaSpace(result.rgb);result.rgb=saturate(result.rgb);");
    expect(helperFunctions.shader).toContain("const float LinearEncodePowerApprox=2.2;const float GammaEncodePowerApprox=1.0/LinearEncodePowerApprox;");
    expect(babylon).toContain(
      "vec3 resultHighContrast=result.rgb*result.rgb*(3.0-2.0*result.rgb);if (contrast<1.0) {result.rgb=mix(vec3(0.5,0.5,0.5),result.rgb,contrast);} " +
        "else {result.rgb=mix(result.rgb,resultHighContrast,contrast-1.0);}\nresult.rgb=max(result.rgb,0.);",
    );
    // The stage's: Babylon's selections made by step and mix, the compression
    // worked from the peak held at the start or above it.
    expect(FRAGMENT).toContain(`vec3 midgeNeutral(vec3 color) {
  float x = min(color.r, min(color.g, color.b));
  float offset = mix(x - 6.25 * x * x, 0.04, step(0.08, x));
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  float top = max(peak, MIDGE_NEUTRAL_START);
  float k = 1.0 - MIDGE_NEUTRAL_START;
  float newPeak = 1.0 - k * k / (top + k - MIDGE_NEUTRAL_START);
  float g = 1.0 - 1.0 / (MIDGE_NEUTRAL_DESATURATION * (top - newPeak) + 1.0);
  vec3 compressed = mix(color * (newPeak / top), vec3(newPeak), g);
  return mix(color, compressed, step(MIDGE_NEUTRAL_START, peak));
}`);
    expect(FRAGMENT).toContain(`vec3 midgeContrastOf(vec3 c) {
  vec3 high = c * c * (3.0 - 2.0 * c);
  vec3 low = mix(vec3(0.5), c, midgeContrast);
  vec3 raised = mix(c, high, midgeContrast - 1.0);
  return max(mix(low, raised, step(1.0, midgeContrast)), 0.0);
}`);
    // The stage's Neutral is Babylon's: dark, below the start, about it and far past it.
    const colours = [[0, 0, 0], [0.05, 0.02, 0.01], [0.3, 0.1, 0.12], [0.79, 0.06, 0.07], [0.8, 0.8, 0.8], [1.2, 0.9, 0.3], [6.875, 0.825, 0.175], [40, 3, 1]];
    for (const rgb of colours) {
      const theirs = babylonNeutral(rgb);
      stageNeutral(rgb).forEach((v, i) => expect(v, `${rgb}`).toBeCloseTo(theirs[i]!, 12));
    }
    // At a peak of 0.52 the compression's divisor is 0: worked from the peak
    // itself, the side not taken would be no number, and a mix that takes
    // none of it still takes the NaN. Held at the start, it stays a number.
    const start = c("MIDGE_NEUTRAL_START");
    expect(0.52 + (1 - start) - start).toBe(0);
    expect(mix(0.52, Number.NaN, 0)).toBeNaN();
    expect(stageNeutral([0.52, 0, 0])).toEqual([0.52, 0, 0]);

    // A midge seen level toward the sun at a quarter past six under a clear
    // sky, at the coverage floor: its glint times its coverage, at the
    // frame's exposure then and the material path's contrast.
    const dusk = [0.66, 0.17, 0.19];
    // The post path: as it was, whatever the exposure and the contrast; the
    // post chain tones it with the frame it lands in.
    expect(stageColour(dusk, 1.27, 0, 1.1)).toEqual([0.66, 0.17, 0.19]);
    expect(stageColour(dusk, 0.25, 0, 0.9)).toEqual([0.66, 0.17, 0.19]);
    // The material path: exposed, compressed, encoded and contrasted as the
    // trees behind it were, brighter and less red than the linear glint
    // written into the encoded frame.
    stageColour(dusk, 1.27, 1, 1.1).forEach((v, i) => expect(v).toBeCloseTo([0.907123, 0.450767, 0.480724][i]!, 6));
    // The stare at its fullest leaves 0.7 of the exposure: the midges dim with the frame.
    stageColour(dusk, 1.27 * sightUnder(1), 1, 1.1).forEach((v, i) => expect(v).toBeCloseTo([0.769478, 0.362247, 0.389022][i]!, 6));
    // Forty-five degrees off the sun at six: the linear glint clipped to a
    // saturated orange, (1, 0.66, 0.14); toned, it rolls off toward white.
    stageColour([5.5, 0.66, 0.14], 1.25, 1, 1.1).forEach((v, i) => expect(v).toBeCloseTo([0.996254, 0.754451, 0.720447][i]!, 6));
    // An empty corner of the card adds no light.
    expect(stageColour([0, 0, 0], 1.27, 1, 1.1)).toEqual([0, 0, 0]);
  });
});

describe("the midges' stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => { translators = await startTranslators(); }, timeLimit(60_000));

  for (const colourPath of ["post", "material"] as const) {
    it(`compile through glslang and translate to WGSL on the ${colourPath} path, reading no texture`, async () => {
      const gpu = webgpuProcessingEngine();
      const gpuScene = new Scene(gpu);
      try {
        gpuScene.activeCamera = new UniversalCamera("eye", new Vector3(0, 2, 0), gpuScene);
        const made = createMidgeSwarms(gpuScene, [4, 2], colourPath);
        const effect = await drawnEffect(made.mesh);
        const defines = (effect as unknown as { defines: string }).defines;
        expect(defines).toContain("THIN_INSTANCES");
        const stage = (kind: "vertex" | "fragment", code: string) =>
          translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
        const vertex = stage("vertex", effect._vertexSourceCode);
        const fragment = stage("fragment", effect._fragmentSourceCode);
        expect(vertex).toContain("midgeSwarms");
        expect(vertex).toContain("array<vec4<f32>, 96u>");
        expect(vertex).toContain("midge");
        expect(fragment).toContain("midgeSunLight");
        expect(fragment).toContain("midgeSkyGlow");
        expect(fragment).toContain("midgeExposure");
        expect(fragment).toContain("midgeToneMap");
        expect(fragment).toContain("midgeContrast");
        expect(vertex).not.toMatch(/textureSample/);
        expect(fragment).not.toMatch(/textureSample/);
        made.dispose();
      } finally {
        gpuScene.dispose();
        gpu.dispose();
      }
    }, timeLimit(60_000));
  }
});
