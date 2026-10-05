import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import {
  createMidgeSwarms, MIDGE_DARK, MIDGE_FLASH_GAIN, MIDGE_FLASH_POWER, MIDGE_LOBE_POWER, MIDGE_NAME, MIDGE_UNIFORMS,
  type MidgeFrame, type MidgeSwarms,
} from "../../src/game/midgeSwarms.js";
import {
  MIDGE_AMPS, MIDGE_BALL_FLAT, MIDGE_CARD, MIDGE_FLASH_HZ, MIDGE_MIN_PX, MIDGE_RATES, MIDGE_SWARMS_MAX, SWARM_ROW_FLOATS,
  midgeHash, midgeOffset,
} from "../../src/game/midgeMotion.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const VERTEX = fx("midge.vertex.fx");
const FRAGMENT = fx("midge.fragment.fx");

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
    night: 0.25, skyLuma: 0.4, pixelAt1m: 0.0011, table,
  };
}

describe("createMidgeSwarms", () => {
  it("is one unit card named midge, blended premultiplied, out of the fog, never culled, picked or shadowed", () => {
    const s = scene();
    swarms = createMidgeSwarms(s, [4]);
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
      const made = createMidgeSwarms(gpuScene, [4]);
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
    swarms = createMidgeSwarms(s, [4]);
    expect(Effect.ShadersStore["midgeVertexShader"]).toBe(VERTEX);
    expect(Effect.ShadersStore["midgeFragmentShader"]).toBe(FRAGMENT);
    const options = held(swarms)._options;
    expect(options.attributes).toEqual(["position", "midge"]);
    expect(options.uniforms).toEqual([
      "viewProjection",
      "midgeEye", "midgeTime", "midgeSun", "midgeSunLight", "midgeNight", "midgeSkyLuma", "midgePixel",
      "midgeSwarms",
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
    swarms = createMidgeSwarms(s, [3, 0, 2, 1]);
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
    swarms = createMidgeSwarms(s, blocks);
    expect(swarms.mesh.thinInstanceCount).toBe(13_750);
    const midge = swarms.mesh.getVertexBuffer("midge")!.getData() as Float32Array;
    expect(midge.length).toBe(27_500);
    // The last instance is the fifth head's last slot.
    expect([...midge.subarray(27_498)]).toEqual([29, 149]);
  });

  it("draws nothing where no row has an instance", () => {
    const s = scene();
    swarms = createMidgeSwarms(s, [0, 0, 0]);
    expect(swarms.mesh.thinInstanceCount).toBe(0);
    expect(swarms.mesh.isEnabled()).toBe(false);
    expect(swarms.mesh.isVerticesDataPresent("midge")).toBe(false);
  });

  it("refuses more rows than the table holds", () => {
    const s = scene();
    expect(() => createMidgeSwarms(s, Array<number>(33).fill(1))).toThrow("createMidgeSwarms: 33 rows, the table holds 32");
  });

  it("starts with every row empty, no count and no presence, so nothing shows before the first update", () => {
    const s = scene();
    swarms = createMidgeSwarms(s, [4]);
    const m = held(swarms);
    expect(m._floats).toEqual({ midgeTime: 0, midgeNight: 0, midgeSkyLuma: 0, midgePixel: 0 });
    expect(m._vectors3["midgeEye"]!.asArray()).toEqual([0, 0, 0]);
    expect(m._vectors3["midgeSun"]!.asArray()).toEqual([0, 1, 0]);
    expect(m._vectors3["midgeSunLight"]!.asArray()).toEqual([0, 0, 0]);
    const table = m._vectors4Arrays["midgeSwarms"]!;
    expect(table.length).toBe(384);
    expect(table.every((v) => v === 0)).toBe(true);
  });

  it("update sets every uniform from the frame, through the objects made with the midges, every time", () => {
    const s = scene();
    swarms = createMidgeSwarms(s, [4]);
    const m = held(swarms);
    swarms.update(frame(12.5));
    const eye = m._vectors3["midgeEye"];
    const sun = m._vectors3["midgeSun"];
    const sunLight = m._vectors3["midgeSunLight"];
    const table = m._vectors4Arrays["midgeSwarms"];
    expect(m._floats).toEqual({ midgeTime: 12.5, midgeNight: 0.25, midgeSkyLuma: 0.4, midgePixel: 0.0011 });
    expect(eye!.asArray()).toEqual([1, 2, 3]);
    expect(sun!.asArray()).toEqual([0, 0.6, 0.8]);
    expect(sunLight!.asArray()).toEqual([2, 1.5, 1]);
    expect([...table!.subarray(0, 12)]).toEqual([4, 2.5, -6, 0.5, 0.5, 40, 1, 0, 0, 0, 17, 0]);

    const next = frame(13);
    next.eyeX = 7;
    next.table[5] = 25;
    swarms.update(next);
    // The same objects, refilled: nothing is made per frame.
    expect(m._vectors3["midgeEye"]).toBe(eye);
    expect(m._vectors3["midgeSun"]).toBe(sun);
    expect(m._vectors3["midgeSunLight"]).toBe(sunLight);
    expect(m._vectors4Arrays["midgeSwarms"]).toBe(table);
    // Its own table, a copy of the frame's.
    expect(table).not.toBe(next.table);
    expect(m._floats["midgeTime"]).toBe(13);
    expect(eye!.asArray()).toEqual([7, 2, 3]);
    expect(table![5]).toBe(25);
  });

  it("dispose takes the mesh and the material out of the scene", () => {
    const s = scene();
    const made = createMidgeSwarms(s, [4, 2]);
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
      MIDGE_CARD: "0.002", MIDGE_MIN_PX: "1.2",
      MIDGE_FLASH_LOW: "9.0", MIDGE_FLASH_HIGH: "14.0",
      MIDGE_LOBE_POWER: "8.0", MIDGE_FLASH_POWER: "24.0", MIDGE_FLASH_GAIN: "0.5",
      MIDGE_DARK: "0.6",
    });
    expect(consts["MIDGE_TAU"]).toBe((2 * Math.PI).toFixed(8));
    MIDGE_RATES.forEach((rate, k) => expect(consts[`MIDGE_RATE_${k}`]).toBe(glslFloat(rate)));
    MIDGE_AMPS.forEach((amp, k) => expect(consts[`MIDGE_AMP_${k}`]).toBe(glslFloat(amp)));
    expect(consts["MIDGE_BALL_FLAT"]).toBe(glslFloat(MIDGE_BALL_FLAT));
    expect(consts["MIDGE_CARD"]).toBe(glslFloat(MIDGE_CARD));
    expect(consts["MIDGE_MIN_PX"]).toBe(glslFloat(MIDGE_MIN_PX));
    expect(consts["MIDGE_FLASH_LOW"]).toBe(glslFloat(MIDGE_FLASH_HZ[0]));
    expect(consts["MIDGE_FLASH_HIGH"]).toBe(glslFloat(MIDGE_FLASH_HZ[1]));
    expect(consts["MIDGE_LOBE_POWER"]).toBe(glslFloat(MIDGE_LOBE_POWER));
    expect(consts["MIDGE_FLASH_POWER"]).toBe(glslFloat(MIDGE_FLASH_POWER));
    expect(consts["MIDGE_FLASH_GAIN"]).toBe(glslFloat(MIDGE_FLASH_GAIN));
    expect(consts["MIDGE_DARK"]).toBe(glslFloat(MIDGE_DARK));
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
    expect(VERTEX).toContain("vAlpha = MIDGE_CARD / size * shape.z * alive;");
    expect(VERTEX).toContain("float lobe = pow(max(dot(-view, midgeSun), 0.0), MIDGE_LOBE_POWER);");
    expect(VERTEX).toContain("float rate = mix(MIDGE_FLASH_LOW, MIDGE_FLASH_HIGH, midgeHash(slot, seed + 73.0));");
    expect(VERTEX).toContain(
      "float flash = pow(max(sin(MIDGE_TAU * rate * t + MIDGE_TAU * midgeHash(slot, seed + 71.0)), 0.0), MIDGE_FLASH_POWER);",
    );
    expect(VERTEX).toContain("vLight = lobe + MIDGE_FLASH_GAIN * flash;");
    expect(FRAGMENT).toContain("vec3 glint = midgeSunLight * (1.0 - midgeNight) * vLight;");
    expect(FRAGMENT).toContain("float speck = MIDGE_DARK * clamp(midgeSkyLuma, 0.0, 1.0);");
    expect(FRAGMENT).toContain("gl_FragColor = vec4(glint * a, speck * a);");
    const both = `${VERTEX}\n${FRAGMENT}`;
    expect(both).not.toMatch(/\btexture\w*\s*\(/);
    expect(both).not.toMatch(/sampler/);
    expect(both).not.toMatch(/\bif\s*\(/);
    expect(both).not.toMatch(/\?/);
    expect(both).not.toContain("discard");
  });
});

describe("the midges' stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => { translators = await startTranslators(); }, timeLimit(60_000));

  it("compile through glslang and translate to WGSL, reading no texture", async () => {
    const gpu = webgpuProcessingEngine();
    const gpuScene = new Scene(gpu);
    try {
      gpuScene.activeCamera = new UniversalCamera("eye", new Vector3(0, 2, 0), gpuScene);
      const made = createMidgeSwarms(gpuScene, [4, 2]);
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
      expect(vertex).not.toMatch(/textureSample/);
      expect(fragment).not.toMatch(/textureSample/);
      made.dispose();
    } finally {
      gpuScene.dispose();
      gpu.dispose();
    }
  }, timeLimit(60_000));
});
