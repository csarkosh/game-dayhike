import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import {
  SURF_SPRAY_BURSTS, SURF_SPRAY_DRAG, SURF_SPRAY_ELEVATION, SURF_SPRAY_G, SURF_SPRAY_LIFE_S, SURF_SPRAY_OPACITY,
  SURF_SPRAY_PER_BURST, SURF_SPRAY_SIZE_M, SURF_SPRAY_SPEED_MIN, SURF_SPRAY_STRETCH_M, SprayPlugin, createSurfSpray,
  sprayPointAt, spraySeeds, type SprayPoint, type SurfSpray,
} from "../../src/game/surfSpray.js";
import { WATER_GROUP } from "../../src/game/waterFrame.js";
import type { WindRecord } from "../../src/game/windParams.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** A still day, and a wind blowing toward +x at half the game's speed. */
const CALM: WindRecord = { dirX: 1, dirZ: 0, speed: 0, lean: 0, gustAmp: 0, flutterAmp: 0, time: 0 };
const ONSHORE: WindRecord = { dirX: 1, dirZ: 0, speed: 0.5, lean: 0, gustAmp: 0, flutterAmp: 0, time: 0 };

const shader = (name: string): string =>
  readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");

/** Every `const float NAME = value;` a stage declares. */
function constants(glsl: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of glsl.matchAll(/const float (\w+) = ([-\d.e]+);/g)) out[m[1] as string] = Number(m[2]);
  return out;
}

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

describe("createSurfSpray", () => {
  it("makes six bursts of sixty thin-instanced quads once, each with four hashes and its slot, off until a burst lives", () => {
    const set = vi.spyOn(Mesh.prototype, "thinInstanceSetBuffer");
    let spray: SurfSpray;
    let calls: unknown[][];
    try {
      spray = createSurfSpray(scene, 0);
    } finally {
      calls = set.mock.calls.map((call) => [...call]);
      set.mockRestore();
    }
    expect(SURF_SPRAY_BURSTS).toBe(6);
    expect(SURF_SPRAY_PER_BURST).toBe(60);
    expect(spray.mesh.name).toBe("surf_spray");
    expect(spray.mesh.thinInstanceCount).toBe(360);
    expect(spray.mesh.isEnabled()).toBe(false);
    // Three static buffers, each given once: the identities, the hashes and the slots.
    const given = new Map(calls.map((call) => [call[0], call]));
    expect(calls.map((call) => [call[0], call[2], call[3]])).toEqual([
      ["matrix", 16, true], ["spraySeed", 4, true], ["sprayBurst", 1, true],
    ]);
    const matrices = given.get("matrix")![1] as Float32Array;
    expect(matrices.length).toBe(5760);
    expect(Array.from(matrices.subarray(16, 32))).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const seeds = given.get("spraySeed")![1] as Float32Array;
    expect(seeds.length).toBe(1440);
    expect(Array.from(seeds)).toEqual(Array.from(spraySeeds(360, 0x53707279)));
    // The first instance's four hashes, the same on every load.
    expect(Array.from(seeds.subarray(0, 4))).toEqual([0.7077431082725525, 0.9352121949195862, 0.1736280918121338, 0.14769387245178223]);
    for (const h of seeds) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
    const slots = given.get("sprayBurst")![1] as Float32Array;
    expect(slots.length).toBe(360);
    expect([slots[0], slots[59], slots[60], slots[299], slots[300], slots[359]]).toEqual([0, 0, 1, 4, 5, 5]);
    spray.dispose();
  });

  it("is unlit, alpha-blended, depth-tested but not written, two-sided, fogged, never picked or shadowed, always active, last of its group", () => {
    for (const group of [0, WATER_GROUP]) {
      const spray = createSurfSpray(scene, group);
      const mat = spray.mesh.material as StandardMaterial;
      expect(mat.name).toBe("mat_surf_spray");
      expect(mat.disableLighting).toBe(true);
      expect(mat.needAlphaBlending()).toBe(true);
      expect(mat.needAlphaTesting()).toBe(false);
      expect(mat.disableDepthWrite).toBe(true);
      expect(mat.backFaceCulling).toBe(false);
      expect(mat.fogEnabled).toBe(true);
      expect(mat.pluginManager?.getPlugin("Spray")).toBe(spray.plugin);
      expect(spray.plugin).toBeInstanceOf(SprayPlugin);
      expect(spray.mesh.renderingGroupId).toBe(group);
      expect(spray.mesh.alphaIndex).toBe(Number.POSITIVE_INFINITY);
      expect(spray.mesh.isPickable).toBe(false);
      expect(spray.mesh.receiveShadows).toBe(false);
      expect(spray.mesh.alwaysSelectAsActiveMesh).toBe(true);
      expect(spray.mesh.doNotSyncBoundingInfo).toBe(true);
      spray.dispose();
    }
  });

  it("takes the slot started longest ago: the seventh burst replaces the first, with its origin, its level unit direction and its speed", () => {
    const spray = createSurfSpray(scene, 0);
    for (let i = 0; i < 6; i++) spray.burst(100 + i, 2, -40, 1, 0, 4, 10 + i);
    spray.burst(200, 3, -50, 3, 4, 5, 16);
    const b = spray.plugin.bursts;
    expect(Array.from(b.subarray(0, 8))).toEqual([200, 3, -50, 0, 0.6000000238418579, 0.800000011920929, 5, 0]);
    for (let s = 1; s < 6; s++) expect([b[s * 8], b[s * 8 + 4], b[s * 8 + 5], b[s * 8 + 6]]).toEqual([100 + s, 1, 0, 4]);
    // The eighth takes the second's slot, started at 11 s, the oldest left.
    spray.burst(300, 1, -60, 0, 1, 2, 17);
    expect([b[8], b[12], b[13], b[14]]).toEqual([300, 0, 1, 2]);
    expect(b[0]).toBe(200);
    // A direction of no length is thrown toward the land.
    spray.burst(400, 1, -60, 0, 0, 2, 18);
    expect([b[16], b[20], b[21]]).toEqual([400, 1, 0]);
    spray.dispose();
  });

  it("writes each slot's age at the shared seconds and draws only while one is alive", () => {
    const spray = createSurfSpray(scene, 0);
    const b = spray.plugin.bursts;
    spray.update(1000, CALM);
    // No slot started: every age past the longest life, nothing drawn.
    expect([0, 1, 2, 3, 4, 5].map((s) => b[s * 8 + 3])).toEqual([3, 3, 3, 3, 3, 3]);
    expect(spray.mesh.isEnabled()).toBe(false);
    spray.burst(0, 1, 0, 1, 0, 4, 1000);
    spray.update(1000.5, CALM);
    expect(b[3]).toBe(0.5);
    expect(b[11]).toBe(3);
    expect(spray.mesh.isEnabled()).toBe(true);
    spray.update(1001.99, CALM);
    expect(spray.mesh.isEnabled()).toBe(true);
    spray.update(1002, CALM);
    expect(b[3]).toBe(2);
    expect(spray.mesh.isEnabled()).toBe(false);
    // The shared seconds stepped back before the burst: not yet alive.
    spray.update(999.9, CALM);
    expect(b[3]).toBeCloseTo(-0.1, 4);
    expect(spray.mesh.isEnabled()).toBe(false);
    spray.dispose();
  });

  it("hands the plugin the eye, the wind's velocity, and the foam's white under the sun and the fill", () => {
    const own = new Scene(engine);
    new UniversalCamera("eye", new Vector3(3, 4, 5), own);
    const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), own);
    sun.intensity = 2;
    sun.diffuse = new Color3(1, 0.5, 0.25);
    const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), own);
    fill.intensity = 0.5;
    fill.diffuse = new Color3(0.2, 0.4, 0.8);
    const spray = createSurfSpray(own, 0);
    spray.burst(0, 1, 0, 1, 0, 4, 10);
    spray.update(10.25, ONSHORE);
    const p = spray.plugin;
    expect([p.camX, p.camY, p.camZ]).toEqual([3, 4, 5]);
    // Half the game's wind is 6 m/s, toward +x.
    expect([p.windX, p.windZ]).toEqual([6, 0]);
    // 0.4 of (2 · (1, 0.5, 0.25) + 0.5 · (0.2, 0.4, 0.8)) = 0.4 · (2.1, 1.2, 0.9).
    const mat = spray.mesh.material as StandardMaterial;
    expect(mat.emissiveColor.r).toBeCloseTo(0.84, 6);
    expect(mat.emissiveColor.g).toBeCloseTo(0.48, 6);
    expect(mat.emissiveColor.b).toBeCloseTo(0.36, 6);
    spray.dispose();
    own.dispose();
  });

  it("makes no burst of a value that is not a finite number, and holds a wind that is not one to none", () => {
    const spray = createSurfSpray(scene, 0);
    spray.burst(Number.NaN, 1, 0, 1, 0, 4, 10);
    spray.burst(0, 1, 0, 1, 0, Number.POSITIVE_INFINITY, 10);
    spray.burst(0, 1, 0, 1, 0, 4, Number.NaN);
    spray.update(10.5, CALM);
    expect(spray.mesh.isEnabled()).toBe(false);
    expect(Array.from(spray.plugin.bursts).every(Number.isFinite)).toBe(true);
    spray.burst(0, 1, 0, 1, 0, 4, 10);
    spray.update(Number.NaN, CALM);
    expect(spray.mesh.isEnabled()).toBe(false);
    expect(Array.from(spray.plugin.bursts).every(Number.isFinite)).toBe(true);
    spray.update(10.5, { ...CALM, speed: Number.NaN, dirX: Number.NaN });
    expect([spray.plugin.windX, spray.plugin.windZ]).toEqual([0, 0]);
    spray.dispose();
  });

  it("makes nothing per frame: the same slots, buffers and colour after a thousand bursts and updates", () => {
    const own = new Scene(engine);
    new UniversalCamera("eye", new Vector3(0, 2, 0), own);
    const spray = createSurfSpray(own, 0);
    const setBuffer = vi.spyOn(spray.mesh, "thinInstanceSetBuffer");
    const bursts = spray.plugin.bursts;
    const colour = (spray.mesh.material as StandardMaterial).emissiveColor;
    for (let i = 0; i < 1000; i++) {
      if (i % 7 === 0) spray.burst(i, 1, -i, 1, 0.5, 4, i / 60);
      spray.update(i / 60, ONSHORE);
    }
    expect(spray.plugin.bursts).toBe(bursts);
    expect((spray.mesh.material as StandardMaterial).emissiveColor).toBe(colour);
    expect(spray.mesh.thinInstanceCount).toBe(360);
    expect(setBuffer).not.toHaveBeenCalled();
    spray.dispose();
    own.dispose();
  });

  it("dispose takes the mesh and the material out of the scene", () => {
    const spray = createSurfSpray(scene, 0);
    const mat = spray.mesh.material as StandardMaterial;
    expect(scene.materials).toContain(mat);
    spray.dispose();
    expect(spray.mesh.isDisposed()).toBe(true);
    expect(scene.meshes).not.toContain(spray.mesh);
    expect(scene.materials).not.toContain(mat);
  });
});

describe("a sprite's path", () => {
  const SEED = [0.25, 0.5, 0.5, 0.5];
  const BURST = { x: 10, y: 1, z: -5, age: 0, dirX: 1, dirZ: 0, speed: 4 };
  const point = (): SprayPoint => ({ x: 0, y: 0, z: 0, alpha: 0, size: 0 });

  it("starts on the stretch across the throw, whole and at half its size", () => {
    // The first hash a quarter along: 5 m to the throw's left, of the 20 m stretch.
    expect(sprayPointAt(BURST, SEED, 2, 0, point())).toEqual({ x: 10, y: 1, z: -10, alpha: 1, size: 0.3 });
  });

  it("at half its life is thrown, dragged, fallen and drifted downwind, half faded and three quarters grown", () => {
    // A life of 1.5 s, at 0.75 s: thrown at 0.775 rad and 3 m/s, under a 2 m/s wind toward +x.
    const p = sprayPointAt({ ...BURST, age: 0.75 }, SEED, 2, 0, point());
    expect(p.x).toBeCloseTo(11.564501588378405, 12);
    expect(p.y).toBeCloseTo(-0.015381707612349249, 12);
    expect(p.z).toBe(-10);
    expect(p.alpha).toBe(0.5);
    expect(p.size).toBeCloseTo(0.45, 12);
    // Thrown along (0.6, 0.8): the stretch turns with it.
    const turned = sprayPointAt({ ...BURST, age: 0.75, dirX: 0.6, dirZ: 0.8 }, SEED, 2, 0, point());
    expect(turned.x).toBeCloseTo(15.178515602284829, 12);
    expect(turned.y).toBeCloseTo(-0.015381707612349249, 12);
    expect(turned.z).toBeCloseTo(-7.228028027812849, 12);
  });

  it("is gone at the end of its life and before its burst", () => {
    expect(sprayPointAt({ ...BURST, age: 1.5 }, SEED, 2, 0, point())).toMatchObject({ alpha: 0, size: 0 });
    expect(sprayPointAt({ ...BURST, age: -0.1 }, SEED, 2, 0, point())).toMatchObject({ alpha: 0, size: 0 });
  });

  it("is the vertex stage's, constant for constant and line for line", () => {
    const vertex = shader("surfSpray.vertex.fx");
    expect(constants(vertex)).toEqual({
      SURF_SPRAY_G, SURF_SPRAY_DRAG, SURF_SPRAY_LIFE_MIN: SURF_SPRAY_LIFE_S[0], SURF_SPRAY_LIFE_MAX: SURF_SPRAY_LIFE_S[1],
      SURF_SPRAY_SIZE: SURF_SPRAY_SIZE_M, SURF_SPRAY_STRETCH: SURF_SPRAY_STRETCH_M,
      SURF_SPRAY_ELEVATION_MIN: SURF_SPRAY_ELEVATION[0], SURF_SPRAY_ELEVATION_MAX: SURF_SPRAY_ELEVATION[1],
      SURF_SPRAY_SPEED_MIN,
    });
    expect(constants(shader("surfSpray.fragment.fx"))).toEqual({ SURF_SPRAY_OPACITY });
    expect([SURF_SPRAY_G, SURF_SPRAY_DRAG, SURF_SPRAY_SIZE_M, SURF_SPRAY_STRETCH_M, SURF_SPRAY_OPACITY]).toEqual([9.81, 1.5, 0.6, 20, 0.5]);
    expect(SURF_SPRAY_LIFE_S).toEqual([1, 2]);
    expect(vertex).toContain("float alive = step(0.0, origin.w) * (1.0 - step(life, origin.w));");
    expect(vertex).toContain("vec3 start = origin.xyz + across * (spraySeed.x - 0.5) * SURF_SPRAY_STRETCH;");
    expect(vertex).toContain("vec3 v0 = (ahead * cos(elevation) + vec3(0.0, sin(elevation), 0.0)) * speed;");
    expect(vertex).toContain("vec3 drift = vec3(surfSprayWind.x, -SURF_SPRAY_G / SURF_SPRAY_DRAG, surfSprayWind.y);");
    expect(vertex).toContain("vec3 p = start + drift * t + (v0 - drift) * (1.0 - exp(-SURF_SPRAY_DRAG * t)) / SURF_SPRAY_DRAG;");
    expect(vertex).toContain("float size = SURF_SPRAY_SIZE * (0.5 + 0.5 * lived) * alive;");
    expect(vertex).toContain("return vec4(p + (right * corner.x + up * corner.y) * size, (1.0 - lived) * alive);");
  });
});

describe("the spray plugin", () => {
  it("declares the define, the seed and slot attributes, the uniforms on both lists, and the four hooks", () => {
    const plugin = new SprayPlugin(new StandardMaterial("sp1", scene));
    expect(plugin.getClassName()).toBe("SprayPlugin");
    expect(plugin.priority).toBe(230);
    const defines: Record<string, boolean> = { SPRAY: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines).toEqual({ SPRAY: true });
    const attrs: string[] = [];
    plugin.getAttributes(attrs, scene, undefined as never);
    expect(attrs).toEqual(["spraySeed", "sprayBurst"]);
    const uniforms = plugin.getUniforms();
    expect(uniforms.ubo).toEqual([
      { name: "surfSprayBursts", size: 4, type: "vec4", arraySize: 12 },
      { name: "surfSprayCam", size: 3, type: "vec3" },
      { name: "surfSprayWind", size: 2, type: "vec2" },
    ]);
    expect(uniforms.vertex).toContain("uniform vec4 surfSprayBursts[12];");
    expect(uniforms.vertex).toContain("uniform vec3 surfSprayCam;");
    expect(uniforms.vertex).toContain("uniform vec2 surfSprayWind;");
    expect(uniforms.fragment).toBe("");
    const vertex = plugin.getCustomCode("vertex")!;
    const fragment = plugin.getCustomCode("fragment")!;
    expect(Object.keys(vertex).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_POSITION"]);
    expect(Object.keys(fragment).sort()).toEqual(["CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR", "CUSTOM_FRAGMENT_DEFINITIONS"]);
    expect(plugin.getCustomCode("other")).toBeNull();
    expect(vertex.CUSTOM_VERTEX_DEFINITIONS).toBe(shader("surfSpray.vertex.fx"));
    expect(fragment.CUSTOM_FRAGMENT_DEFINITIONS).toBe(shader("surfSpray.fragment.fx"));
    expect(vertex.CUSTOM_VERTEX_UPDATE_POSITION).toContain("vec4 sprayAt = sprayPlace(position.xy);");
    expect(vertex.CUSTOM_VERTEX_UPDATE_POSITION).toContain("positionUpdated = sprayAt.xyz;");
    expect(vertex.CUSTOM_VERTEX_UPDATE_POSITION).toContain("vSprayAlpha = sprayAt.w;");
    expect(fragment.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toContain("color.a *= sprayCover();");
  });

  it("writes every uniform it declares in bindForSubMesh, the slots as one array", () => {
    const plugin = new SprayPlugin(new StandardMaterial("sp2", scene));
    plugin.bursts[0] = 7;
    plugin.camX = 1; plugin.camY = 2; plugin.camZ = 3;
    plugin.windX = 4; plugin.windZ = -5;
    const writes: Record<string, unknown> = {};
    const ubo = {
      updateFloatArray: (n: string, a: Float32Array) => { writes[n] = a; },
      updateFloat2: (n: string, a: number, b: number) => { writes[n] = [a, b]; },
      updateFloat3: (n: string, a: number, b: number, c: number) => { writes[n] = [a, b, c]; },
    } as unknown as UniformBuffer;
    plugin.bindForSubMesh(ubo, scene, engine, undefined as never);
    expect(Object.keys(writes).sort()).toEqual(plugin.getUniforms().ubo.map((u) => u.name).sort());
    expect(writes.surfSprayBursts).toBe(plugin.bursts);
    expect(writes.surfSprayCam).toEqual([1, 2, 3]);
    expect(writes.surfSprayWind).toEqual([4, -5]);
  });
});

describe("the spray material's stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => { translators = await startTranslators(); }, timeLimit(60_000));

  it("compile through glslang and translate to WGSL, fog on: the slots read by the sprite's own slot", async () => {
    const gpu = webgpuProcessingEngine();
    const gpuScene = new Scene(gpu);
    try {
      new UniversalCamera("c", new Vector3(0, 2, 0), gpuScene);
      gpuScene.fogMode = Scene.FOGMODE_EXP2;
      const spray = createSurfSpray(gpuScene, 0);
      spray.burst(0, 1, 10, 1, 0, 4, 0);
      spray.update(0.5, ONSHORE);
      const effect = await drawnEffect(spray.mesh);
      const defines = (effect as unknown as { defines: string }).defines;
      expect(defines).toContain("#define SPRAY");
      expect(effect._vertexSourceCode).toContain("vec4 sprayAt = sprayPlace(position.xy);");
      expect(effect._fragmentSourceCode).toContain("color.a *= sprayCover();");
      const stage = (kind: "vertex" | "fragment", code: string) =>
        translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
      const vertex = stage("vertex", effect._vertexSourceCode);
      const fragment = stage("fragment", effect._fragmentSourceCode);
      expect(vertex).toContain("surfSprayBursts");
      expect(vertex).toContain("spraySeed");
      expect(vertex).toContain("sprayBurst");
      expect(fragment).toContain("vSprayAlpha");
      spray.dispose();
    } finally {
      gpuScene.dispose();
      gpu.dispose();
    }
  }, timeLimit(60_000));
});
