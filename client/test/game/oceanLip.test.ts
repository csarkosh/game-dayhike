// client/test/game/oceanLip.test.ts
/**
 * The plunging lip's strip on the high tier (oceanLip.ts, shaders/oceanLip*.fx):
 * its base on the rings' surface (the vertex stage's TypeScript twin,
 * lipVertexAt, against swellAt), the shader's constants in lockstep, the
 * meshes and the material as the sea's are made, when each mesh draws, what
 * dispose frees, and the strip's stages compiled through glslang to WGSL.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import { COVE_FACE_GRADE, COVE_TOE_DEPTH, coveFor } from "../../src/sim/olympic.js";
import { OCEAN_COAST_STEP } from "../../src/game/oceanTables.js";
import { coastRead, oceanFieldFor, swellAt, swellPhases, type OceanField } from "../../src/game/oceanWaves.js";
import {
  LIP_COLUMNS, LIP_EDGE_FIRST, LIP_EDGE_LAST, LIP_FOAM_ENVELOPE, LIP_KEYFRAMES, LIP_KEY_THROW, LIP_PROFILE_VERTS, LIP_SLOTS,
  LIP_THROW, LipTracker, lipProfile, lipVertexAt, profileAt,
} from "../../src/game/oceanBreaker.js";
import { LIP_COARSE_M, LIP_FINE_M, createOceanLip, lipColumns } from "../../src/game/oceanLip.js";
import { WaterPlugin, attachWater, oceanArrayPlaceholder, type OceanBinding } from "../../src/game/waterPlugin.js";
import { oceanComponentsFor, oceanTipsFor } from "../../src/game/oceanRender.js";
import { WATER_ROWS } from "../../src/game/waterShading.js";
import { WATER_GROUP } from "../../src/game/waterFrame.js";
import type { SwashCove } from "../../src/game/swashTable.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { LOBBY_SEEDS } from "../sim/trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant("olympic");

const fx = (name: string): string => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** room-3: the cove at z0 = 0, 164.1 m half-wide. */
const SEED = LOBBY_SEEDS[3] as number;
const LEVEL = 0;

function coveOf(seed: number, field: OceanField): SwashCove {
  const c = coveFor(seed);
  return {
    z0: c.z0, halfWidth: c.halfWidth, toeD: -COVE_TOE_DEPTH / COVE_FACE_GRADE, faceGrade: COVE_FACE_GRADE,
    coastX: (z: number) => coastRead(field.tables, z)[0],
  };
}

/** The sea's binding as oceanRender.ts makes one, on the FFT's mode (2), the high tier's. */
function bindingFor(scene: Scene, field: OceanField): OceanBinding {
  return {
    atlas: new RawTexture(
      field.tables.data, field.tables.width, field.tables.rows, Constants.TEXTUREFORMAT_RGBA, scene,
      false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
    ),
    windDisp: oceanArrayPlaceholder(scene),
    windSlope: oceanArrayPlaceholder(scene),
    phases: swellPhases(field, 0),
    components: oceanComponentsFor(field.components),
    swell: [field.travel[0], field.travel[1], field.tp, field.hs],
    tips: oceanTipsFor(field.tips),
    coast: [field.tables.coastOriginZ, OCEAN_COAST_STEP, field.count, 2],
    wind: [0, 1, 0, 0],
    windDir: [1, 0, 6, 0],
    windStats: [0.5, 0.01, 0.02, 0.03],
    windPivot: [-412.5, 37, 0, 0],
  };
}

const floatTexture = (scene: Scene): RawTexture =>
  RawTexture.CreateRTexture(new Float32Array(4), 2, 2, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);

/** The sea's material as createWater makes it on the high tier's path: opaque, its plugin bound and given a bed and a frame. */
function seaMaterial(scene: Scene, field: OceanField): PBRMaterial {
  const sea = new PBRMaterial("mat_water_sea", scene);
  sea.backFaceCulling = false;
  sea.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
  sea.needDepthPrePass = false;
  const plugin = attachWater(sea, WATER_ROWS.sea);
  plugin.bedTexture = floatTexture(scene);
  plugin.sceneTexture = floatTexture(scene);
  plugin.depthTexture = floatTexture(scene);
  plugin.ocean = bindingFor(scene, field);
  return sea;
}

/** A tracker run on until one of its slots holds a crest in mid-plunge, and the time it took. */
function trackerWithACrest(field: OceanField, cove: SwashCove): { tracker: LipTracker; phases: Float32Array; seconds: number } {
  const tracker = new LipTracker(field, cove);
  const phases = new Float32Array(12);
  for (let k = 0; k < 600; k++) {
    tracker.update(k / 20, swellPhases(field, k / 20, phases), 0);
    for (let i = 0; i < LIP_COLUMNS * LIP_SLOTS; i++) {
      if ((tracker.state.data[i * 4 + 1] as number) > 0) return { tracker, phases, seconds: k / 20 };
    }
  }
  throw new Error("no crest plunged in 30 s");
}

describe("the strip's vertices", () => {
  const field = oceanFieldFor(SEED);
  const cove = coveOf(SEED, field);
  const profile = lipProfile();

  it("stands the base of every slot in mid-plunge on the rings' surface, to a tenth of a millimetre", () => {
    const { tracker, phases } = trackerWithACrest(field, cove);
    const out = { x: 0, y: 0, z: 0 };
    let checked = 0;
    for (let i = 0; i < LIP_COLUMNS; i++) {
      for (let s = 0; s < LIP_SLOTS; s++) {
        const slot = tracker.state.data.subarray((s * LIP_COLUMNS + i) * 4, (s * LIP_COLUMNS + i) * 4 + 4);
        if (!((slot[1] as number) > 0)) continue;
        const z = cove.z0 - LIP_COLUMNS / 2 + i;
        const size = (slot[2] as number) * (slot[3] as number);
        // Both feet: the back face's 1.6 heights behind the crest along the travel, the trough's ahead of it.
        for (const v of [0, LIP_PROFILE_VERTS - 1]) {
          lipVertexAt(field, phases, profile, slot, z, v, LEVEL, out);
          const shape = { across: 0, up: 0 };
          profileAt(profile, slot[1] as number, v, shape);
          expect(shape.up).toBe(0);
          if (v === 0) expect(shape.across).toBeCloseTo(-1.6, 6);
          const ax = coastRead(field.tables, z)[0] + (slot[0] as number) + field.travel[0] * shape.across * size;
          const az = z + field.travel[1] * shape.across * size;
          const ring = swellAt(field, phases, ax, az);
          expect(Math.abs(out.y - (LEVEL + ring.height)), `height at column ${i} slot ${s} vertex ${v}`).toBeLessThan(1e-4);
          expect(Math.abs(out.x - (ax + ring.dx)), `x at column ${i}`).toBeLessThan(1e-4);
          expect(Math.abs(out.z - (az + ring.dz)), `z at column ${i}`).toBeLessThan(1e-4);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  }, timeLimit(60_000));

  it("lifts the lip off the surface by its up in units of the height times the share, and folds a free slot onto one point", () => {
    const phases = swellPhases(field, 30);
    const out = { x: 0, y: 0, z: 0 };
    // A crest at d -10 at the throw, 1.2 m high, all of it plunging: the tip, vertex 16, is 0.22 heights up, 0.832 ahead.
    const slot = [-10, 0.6, 1.2, 1];
    lipVertexAt(field, phases, profile, slot, 0, 16, LEVEL, out);
    const ax = coastRead(field.tables, 0)[0] - 10 + field.travel[0] * 0.832 * 1.2;
    const az = field.travel[1] * 0.832 * 1.2;
    const ring = swellAt(field, phases, ax, az);
    expect(out.y - (LEVEL + ring.height)).toBeCloseTo(0.22 * 1.2, 5);
    // a free slot: every vertex at the one point, the coastline at that z, on the surface
    const free = [0, 0, 0, 0];
    const at = { x: 0, y: 0, z: 0 };
    lipVertexAt(field, phases, profile, free, 0, 0, LEVEL, at);
    for (const v of [5, 16, 23]) {
      lipVertexAt(field, phases, profile, free, 0, v, LEVEL, out);
      expect(out).toEqual(at);
    }
  });

  it("holds the shader's constants and its placement line for line with lipVertexAt", () => {
    const s = fx("oceanLipShape.vertex.fx");
    for (const [name, value] of [
      ["LIP_COLUMNS", LIP_COLUMNS], ["LIP_HALF", LIP_COLUMNS / 2], ["LIP_SLOTS", LIP_SLOTS],
      ["LIP_PROFILE_VERTS", LIP_PROFILE_VERTS], ["LIP_KEYFRAMES", LIP_KEYFRAMES], ["LIP_THROW", LIP_THROW],
      ["LIP_KEY_THROW", LIP_KEY_THROW], ["LIP_EDGE_FIRST", LIP_EDGE_FIRST], ["LIP_EDGE_LAST", LIP_EDGE_LAST],
      ["LIP_FOAM_ENVELOPE", LIP_FOAM_ENVELOPE],
    ] as const) expect(s, name).toContain(`const float ${name} = ${glslFloat(value)};`);
    expect([LIP_EDGE_FIRST, LIP_EDGE_LAST, LIP_FOAM_ENVELOPE]).toEqual([14, 18, 1000]);
    for (const line of [
      "  float size = slot.z * slot.w;",
      "  xz = vec2(oceanCoastAt(strip.x, phaseDz).x + slot.x, strip.x) + travel * (shape.x * size);",
      "  vec3 disp = oceanDisplace(xz, sum, sumEnv);",
      "  float lift = shape.y * size;",
      "  return vec3(xz.x, waterLevel, xz.y) + disp + vec3(0.0, lift, 0.0);",
      "  return mix(early, late, step(LIP_THROW, q));",
      "  float k0 = min(floor(k), LIP_KEYFRAMES - 2.0);",
    ]) expect(s, line).toContain(line);
    // every texture read at level 0, in the vertex stage
    expect(s).not.toMatch(/\btexture2D\s*\(|\btexture\s*\(/);
    expect(s.match(/\btextureLod\(/g)).toHaveLength(3);
    const body = fx("oceanLip.vertex.fx");
    expect(body).toContain("positionUpdated = oceanLipPlace(positionUpdated, oceanLipXZ, oceanLipSwell, oceanLipEnv);");
    expect(body).toContain("vOceanXZ = oceanLipXZ;");
  });
});

describe("the strip's meshes", () => {
  it("covers the cove's columns a metre apart and two, with the sea's attributes, level, group and material", () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const field = oceanFieldFor(SEED);
      const cove = coveOf(SEED, field);
      const sea = seaMaterial(scene, field);
      const lip = createOceanLip(scene, () => sea, new LipTracker(field, cove), lipProfile(), cove, 2.5);
      // 164.1 m half-wide and 30 m blends each side: columns 62 to 450
      expect(lipColumns(cove, LIP_FINE_M)).toHaveLength(389);
      expect(lipColumns(cove, LIP_COARSE_M)).toHaveLength(195);
      expect(lip.fine.getTotalVertices()).toBe(389 * 2 * 24);
      expect(lip.coarse.getTotalVertices()).toBe(195 * 2 * 24);
      expect(lip.fine.getTotalIndices()).toBe(388 * 2 * 23 * 6);
      for (const mesh of [lip.fine, lip.coarse]) {
        expect(mesh.getVerticesData("bedDepth")?.every((v) => v === 0)).toBe(true);
        expect(mesh.getVerticesData("oceanMorph")?.every((v) => v === 0)).toBe(true);
        expect(mesh.getVerticesData("oceanCoarse")?.every((v) => v === 0)).toBe(true);
        expect(mesh.metadata).toEqual({ waterLevel: 2.5 });
        expect(mesh.renderingGroupId).toBe(WATER_GROUP);
        expect([mesh.receiveShadows, mesh.isPickable, mesh.isEnabled()]).toEqual([false, false, false]);
        expect(mesh.material?.name).toBe("mat_water_lip");
      }
      // (column z, slot, vertex): the first column's first slot's back foot, the second slot's trough
      const positions = lip.fine.getVerticesData("position") as Float32Array;
      expect(Array.from(positions.subarray(0, 3))).toEqual([-194, 0, 0]);
      expect(Array.from(positions.subarray(positions.length - 3))).toEqual([194, 1, 23]);
      // the box holds the face, not the positions
      const box = lip.fine.getBoundingInfo().boundingBox;
      expect(box.minimumWorld.z).toBe(-218);
      expect(box.maximumWorld.z).toBe(218);
      const material = lip.fine.material as PBRMaterial;
      const plugin = material.pluginManager?.getPlugin("Water");
      expect(plugin).toBeInstanceOf(WaterPlugin);
      expect((plugin as WaterPlugin).lip).toBe(true);
      expect((plugin as WaterPlugin).ocean).toBe((sea.pluginManager?.getPlugin("Water") as WaterPlugin).ocean);
      expect(material.transparencyMode).toBe(PBRMaterial.PBRMATERIAL_OPAQUE);
      expect([lip.state.getSize(), lip.profile.getSize()]).toEqual([{ width: 512, height: 2 }, { width: 24, height: 8 }]);
      lip.dispose();
    } finally {
      engine.dispose();
    }
  });

  it("draws the fine strip near the camera and the coarse one beyond, and neither with no crest in mid-plunge", () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const field = oceanFieldFor(SEED);
      const cove = coveOf(SEED, field);
      const sea = seaMaterial(scene, field);
      const tracker = new LipTracker(field, cove);
      const lip = createOceanLip(scene, () => sea, tracker, lipProfile(), cove, 0);
      const shown = (): [boolean, boolean] => [lip.fine.isEnabled(), lip.coarse.isEnabled()];
      lip.update(cove.coastX(0), 0);
      expect(shown()).toEqual([false, false]);
      const phases = new Float32Array(12);
      let live = false;
      for (let k = 0; k < 600 && !live; k++) {
        tracker.update(k / 20, swellPhases(field, k / 20, phases), 0);
        for (let i = 0; i < LIP_COLUMNS * LIP_SLOTS && !live; i++) live = (tracker.state.data[i * 4 + 1] as number) > 0;
      }
      expect(live).toBe(true);
      // at the waterline, mid-cove: near
      lip.update(cove.coastX(0), 0);
      expect(shown()).toEqual([true, false]);
      // the road, 140 m inland of the face's middle: still near; 400 m out at sea: far
      lip.update(cove.coastX(0) - 12 + 140, 0);
      expect(shown()).toEqual([true, false]);
      lip.update(cove.coastX(0) - 400, 0);
      expect(shown()).toEqual([false, true]);
      // beyond the cove's end along the shore, the distance is to its last column
      lip.update(cove.coastX(194) - 12, 194 + 151);
      expect(shown()).toEqual([false, true]);
      // a full onshore wind frees every slot: neither draws
      tracker.update(30, swellPhases(field, 30, phases), 1);
      lip.update(cove.coastX(0), 0);
      expect(shown()).toEqual([false, false]);
      lip.dispose();
    } finally {
      engine.dispose();
    }
  }, timeLimit(30_000));

  it("closes the strip on the live crest where a slot goes free, over a minute of crests", () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const field = oceanFieldFor(SEED);
      const cove = coveOf(SEED, field);
      const sea = seaMaterial(scene, field);
      const tracker = new LipTracker(field, cove);
      const lip = createOceanLip(scene, () => sea, tracker, lipProfile(), cove, 0);
      const live = (d: Float32Array, o: number): boolean => {
        const p = d[o + 1] as number;
        return p > 0 && p < 1 && (d[o + 2] as number) * (d[o + 3] as number) > 0;
      };
      const phases = new Float32Array(12);
      let boundaries = 0;
      let liveSlots = 0;
      const violations: string[] = [];
      const changed: string[] = [];
      for (let k = 0; k < 1200; k++) {
        tracker.update(k / 20, swellPhases(field, k / 20, phases), 0);
        lip.update(cove.coastX(0), 0);
        const data = tracker.state.data;
        // what the texture was last handed
        const up = (lip.state.getInternalTexture() as unknown as { _bufferView: Float32Array })._bufferView;
        for (let o = 0; o < data.length; o += 4) {
          if (!live(data, o)) continue;
          liveSlots++;
          for (let j = 0; j < 4; j++) if (up[o + j] !== data[o + j]) changed.push(`frame ${k} slot ${o / 4} lane ${j}`);
        }
        for (const step of [LIP_FINE_M, LIP_COARSE_M]) {
          const columns = lipColumns(cove, step);
          for (let s = 0; s < LIP_SLOTS; s++) {
            for (let c = 0; c + 1 < columns.length; c++) {
              const a = (s * LIP_COLUMNS + (columns[c] as number)) * 4;
              const b = (s * LIP_COLUMNS + (columns[c + 1] as number)) * 4;
              if (live(up, a) === live(up, b)) continue;
              boundaries++;
              const [l, f] = live(up, a) ? [a, b] : [b, a];
              const gap = Math.abs((up[f] as number) - (up[l] as number));
              const size = (up[f + 2] as number) * (up[f + 3] as number);
              if (gap > LIP_FINE_M + 2 || size !== 0) violations.push(`frame ${k} step ${step} slot ${s} column ${columns[c]}: gap ${gap} size ${size}`);
            }
          }
        }
      }
      expect(changed).toEqual([]);
      expect(violations).toEqual([]);
      expect([liveSlots, boundaries]).toEqual([52505, 13754]);
      lip.dispose();
    } finally {
      engine.dispose();
    }
  }, timeLimit(60_000));

  it("frees both meshes, both textures and its material on dispose, and leaves the sea's", () => {
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const field = oceanFieldFor(SEED);
      const cove = coveOf(SEED, field);
      const sea = seaMaterial(scene, field);
      const meshes = scene.meshes.length;
      const textures = scene.textures.length;
      const materials = scene.materials.length;
      const lip = createOceanLip(scene, () => sea, new LipTracker(field, cove), lipProfile(), cove, 0);
      expect(scene.meshes.length).toBe(meshes + 2);
      expect(scene.textures.length).toBe(textures + 2);
      expect(scene.materials.length).toBe(materials + 1);
      const material = lip.fine.material;
      lip.dispose();
      expect([lip.fine.isDisposed(), lip.coarse.isDisposed()]).toEqual([true, true]);
      expect(lip.state.getInternalTexture()).toBeNull();
      expect(lip.profile.getInternalTexture()).toBeNull();
      expect(scene.materials).not.toContain(material);
      expect([scene.meshes.length, scene.textures.length, scene.materials.length]).toEqual([meshes, textures, materials]);
      expect(scene.materials).toContain(sea);
    } finally {
      engine.dispose();
    }
  });
});

describe("the strip's stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => {
    translators = await startTranslators();
  }, timeLimit(60_000));

  it("compile through glslang and translate to WGSL, the lip placed in UPDATE_POSITION, its textures read at a fixed level", async () => {
    const engine = webgpuProcessingEngine();
    try {
      const scene = new Scene(engine);
      new UniversalCamera("c", new Vector3(0, 2, 0), scene);
      const field = oceanFieldFor(SEED);
      const cove = coveOf(SEED, field);
      const sea = seaMaterial(scene, field);
      const lip = createOceanLip(scene, () => sea, new LipTracker(field, cove), lipProfile(), cove, 0);
      const effect = await drawnEffect(lip.fine);
      const defines = (effect as unknown as { defines: string }).defines;
      expect(defines).toContain("#define OCEAN_LIP");
      const v = effect._vertexSourceCode;
      const placed = v.indexOf("positionUpdated = oceanLipPlace(positionUpdated, oceanLipXZ, oceanLipSwell, oceanLipEnv);");
      expect(placed).toBeGreaterThan(-1);
      expect(placed).toBeLessThan(v.indexOf("vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);"));
      expect(v).not.toContain("positionUpdated += oceanDisplace(");
      const stage = (kind: "vertex" | "fragment", code: string): string =>
        translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
      const vertex = stage("vertex", v);
      const fragment = stage("fragment", effect._fragmentSourceCode);
      expect(vertex).toContain("oceanLipState");
      expect(vertex).toContain("oceanLipProfile");
      expect(vertex).toMatch(/textureSampleLevel\(/);
      expect(vertex).not.toMatch(/textureSample\(/);
      expect(fragment).toContain("oceanFoamFromEnvelope");
      lip.dispose();
    } finally {
      engine.dispose();
    }
  }, timeLimit(120_000));
});
