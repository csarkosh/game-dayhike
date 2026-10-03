// client/test/game/oceanShader.test.ts
/**
 * The sea's shaders: shaders/oceanSurface.fx (both stages), oceanShade.fragment.fx,
 * the displacement in oceanDisplace.vertex.fx and the OCEAN blocks of
 * waterLights.fragment.fx and waterCompose.fragment.fx. Their constants in
 * lockstep with the TypeScript, their swell the same sum as swellAt's, their
 * order in the stages Babylon builds, the lakes' text untouched, and every
 * tier's stages compiled through glslang and translated to WGSL under Node as
 * the page translates them, the sea's textures read at a fixed level only.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder.js";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import "../../src/sim/olympic.js";
import { setActiveTerrainVariant } from "../../src/sim/terrain.js";
import {
  OCEAN_ROUGHNESS_ANCHOR, OCEAN_ROUGHNESS_CODE, attachWater, oceanArrayPlaceholder, type OceanBinding,
} from "../../src/game/waterPlugin.js";
import { oceanTipsFor } from "../../src/game/oceanRender.js";
import {
  OCEAN_CAP_CELL, OCEAN_CAP_CYCLES, OCEAN_CAP_DRIFT, OCEAN_CAP_INSET, OCEAN_CAP_PERIOD, OCEAN_CAP_RADIUS, OCEAN_CAP_SHARE,
  OCEAN_CAP_SOFT, OCEAN_DETAIL_HI, OCEAN_DETAIL_LO, OCEAN_FOAM_ALBEDO, OCEAN_FOAM_ALBEDO_OLD, OCEAN_FOAM_FADE,
  OCEAN_INNER_COVER, OCEAN_LACE_DRIFT, OCEAN_LACE_FINE, OCEAN_LACE_FINE_SHIFT, OCEAN_LACE_FIT_A, OCEAN_LACE_FIT_B,
  OCEAN_LACE_FIT_C, OCEAN_LACE_FIT_D, OCEAN_LACE_FIT_E, OCEAN_LACE_ONSET, OCEAN_LACE_SOFT, OCEAN_LACE_TILE, OCEAN_LACE_WEIGHT,
  OCEAN_RESOLVE_PHASE_HI, OCEAN_RESOLVE_PHASE_LO, OCEAN_RING_REACH, OCEAN_SLOPE_VAR_FLOOR, WATER_COX_MUNK_A,
  WATER_COX_MUNK_B, WATER_ROWS, capProfile, coxMunkVariance, foamWhite, oceanRingCell, resolvedShare,
  resolvedSlopeVariance, roughnessFor, roughnessFromVariance, slopeVariance, undrawnSlopeVariance, whitecapThreshold,
} from "../../src/game/waterShading.js";
import { OCEAN_G, WEGGEL_GAMMA_MAX, WEGGEL_GAMMA_MIN, WHITECAP_MAX } from "../../src/game/oceanPhysics.js";
import { SWELL_Q_SUM_MAX } from "../../src/game/oceanSwell.js";
import {
  OCEAN_ATLAS_ROWS, OCEAN_COAST_STEP, OCEAN_D_MIN, OCEAN_D_STEP, OCEAN_DRY_DEPTH, OCEAN_ROW_BAY_FIRST,
  OCEAN_ROW_BAY_PROFILE, OCEAN_ROW_COAST, OCEAN_ROW_COMPONENTS, OCEAN_ROW_COVE_FIRST, OCEAN_ROW_COVE_PROFILE,
  OCEAN_TABLE_SAMPLES, coastProfilesFor,
} from "../../src/game/oceanTables.js";
import {
  OCEAN_BORE_RATIO, OCEAN_BREAK_FOAM_HI, OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FULL, OCEAN_FOAM_LIFE, OCEAN_INNER_FOAM,
  OCEAN_ROLL_WIDTH, SHELTER_CHOP, SHELTER_SWELL, SHELTER_WIDTH, oceanFieldFor, swellAt, swellPhases, type OceanField,
} from "../../src/game/oceanWaves.js";
import { WATER_BASE_SPACING, WATER_RING_CELLS, WATER_RING_COUNT, waterRingSpacing } from "../../src/game/water.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine, type ProcessedEffect } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";

setActiveTerrainVariant("olympic");

const fx = (name: string): string => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
function pinned(text: string, name: string, value: number): void {
  expect(text, name).toContain(`const float ${name} = ${glslFloat(value)};`);
}

/** Babylon's preprocessor over one hook's text, as shaderHygiene.test.ts runs it, with a lake's gates on. */
const LAKE_DEFINES = ["#define WATER", "#define BUMP", "#define REFLECTION", "#define SPECULARTERM"];
function processed(source: string, isFragment: boolean): Promise<string> {
  const options: _IProcessingOptions = {
    defines: LAKE_DEFINES,
    indexParameters: {},
    isFragment,
    shouldUseHighPrecisionShader: true,
    supportsUniformBuffers: false,
    shadersRepository: "",
    includesShadersStore: {},
    processor: { shaderLanguage: ShaderLanguage.GLSL },
    version: "",
    platformName: "WEBGL2",
    processingContext: null,
    isNDCHalfZRange: false,
    useReverseDepthBuffer: false,
  };
  return new Promise((resolve) => Process(source, options, (code) => resolve(code)));
}
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

type Tier = "high" | "medium" | "low";
const MODE: Record<Tier, number> = { high: 2, medium: 1, low: 0 };
const SEED = 0x5eed;

function floatTexture(scene: Scene): RawTexture {
  return RawTexture.CreateRTexture(new Float32Array(4), 2, 2, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
}

/** The sea's binding for a tier, as oceanRender.ts makes it: the world's atlas and swell, the scene's array
 * placeholder for the wind sea's fields, the tier's mode. */
function bindingFor(scene: Scene, tier: Tier): OceanBinding {
  const field = oceanFieldFor(SEED, tier === "low" ? 8 : 12);
  return {
    atlas: new RawTexture(
      field.tables.data, field.tables.width, field.tables.rows, Constants.TEXTUREFORMAT_RGBA, scene,
      false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT,
    ),
    windDisp: oceanArrayPlaceholder(scene),
    windSlope: oceanArrayPlaceholder(scene),
    phases: swellPhases(field, 0),
    swell: [field.travel[0], field.travel[1], field.tp, field.hs],
    tips: oceanTipsFor(field.tips),
    coast: [field.tables.coastOriginZ, OCEAN_COAST_STEP, field.count, MODE[tier]],
    wind: [0, 1, 0, 0],
    windDir: [1, 0, 6, 0],
  };
}

/** The water material's effect as Babylon's WebGPU processing builds it for a tier: the sea's, or a lake's. */
async function waterEffect(tier: Tier, lake = false): Promise<{ effect: ProcessedEffect; defines: string; dispose(): void }> {
  const engine = webgpuProcessingEngine();
  const scene = new Scene(engine);
  new UniversalCamera("c", new Vector3(0, 2, 0), scene);
  const mat = new PBRMaterial(lake ? "mat_water_lake_0" : "mat_water_sea", scene);
  mat.backFaceCulling = false;
  mat.transparencyMode = tier === "high" ? PBRMaterial.PBRMATERIAL_OPAQUE : PBRMaterial.PBRMATERIAL_ALPHABLEND;
  const plugin = attachWater(mat, lake ? WATER_ROWS.lowlandLake : WATER_ROWS.sea);
  plugin.octaves = tier === "low" ? 1 : 2;
  plugin.bedTexture = floatTexture(scene);
  if (tier === "high") {
    plugin.sceneTexture = floatTexture(scene);
    plugin.depthTexture = floatTexture(scene);
  }
  // As createWater sets it: the bump on every lake, and on the sea on the low tier alone.
  if (lake || tier === "low") mat.bumpTexture = RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, scene);
  if (!lake) plugin.ocean = bindingFor(scene, tier);
  const mesh = CreateGround("water_0", { width: 64, height: 64, subdivisions: 4 }, scene);
  const count = mesh.getTotalVertices();
  mesh.setVerticesData("bedDepth", new Float32Array(count), false, 1);
  mesh.setVerticesData("oceanMorph", new Float32Array(count), false, 1);
  mesh.setVerticesData("oceanCoarse", new Float32Array(count * 2), false, 2);
  mesh.material = mat;
  const effect = await drawnEffect(mesh);
  return {
    effect,
    defines: (effect as unknown as { defines: string }).defines,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

/** Where `needle` sits in `text`, failing when it is not there. */
function at(text: string, needle: string): number {
  const i = text.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mod = (x: number, y: number): number => x - y * Math.floor(x / y);

/**
 * oceanSwellSum (shaders/oceanSurface.fx) read line for line into TypeScript: the atlas read as the GPU
 * reads the nearest-sampled texture at texel centres, the uniforms as oceanRender.ts writes them, steps
 * (dpx, dpy) as the shader gets them. A difference between this and swellAt is a difference between the
 * shader and swellAt.
 */
function shaderSwell(field: OceanField, phases: Float32Array, px: number, pz: number, dpx: [number, number], dpy: [number, number]) {
  const t = field.tables;
  const swell = [field.travel[0], field.travel[1], field.tp];
  const tips = field.tips;
  const coastU = [t.coastOriginZ, OCEAN_COAST_STEP, field.count];
  const texel = (row: number, column: number): number[] => {
    const o = (row * t.width + column) * 4;
    return [t.data[o] as number, t.data[o + 1] as number, t.data[o + 2] as number, t.data[o + 3] as number];
  };
  const read = (row: number, column: number): number[] => {
    const c = Math.min(Math.max(column, 0), OCEAN_TABLE_SAMPLES - 1);
    const i0 = Math.floor(c);
    const a = texel(row, i0);
    const b = texel(row, Math.min(i0 + 1, OCEAN_TABLE_SAMPLES - 1));
    return a.map((v, j) => v + ((b[j] as number) - v) * (c - i0));
  };
  const shelterTip = (x: number, z: number, tip: [number, number], keep: number): number => {
    const [ux, uz] = [swell[0] as number, swell[1] as number];
    const rx = x - tip[0];
    const rz = z - tip[1];
    const side = uz >= 0 ? 1 : -1;
    const on = (ux * rx + uz * rz >= 0 ? 1 : 0) * (rz * side >= 0 ? 1 : 0);
    const lambda = -(ux * rz - uz * rx) * side;
    return 1 - (1 - keep) * smoothstep(0, SHELTER_WIDTH, lambda) * on;
  };
  // oceanCoastAt: the row at the column, and the phase weight's slope from the two texels that read mixes.
  const coastColumn = (pz - (coastU[0] as number)) / (coastU[1] as number);
  const coast = read(OCEAN_ROW_COAST, coastColumn);
  const coastI0 = Math.floor(Math.min(Math.max(coastColumn, 0), OCEAN_TABLE_SAMPLES - 1));
  const coastHere = texel(OCEAN_ROW_COAST, coastI0)[3] as number;
  const coastNext = texel(OCEAN_ROW_COAST, Math.min(coastI0 + 1, OCEAN_TABLE_SAMPLES - 1))[3] as number;
  const phaseDz = coastColumn < 0 ? 0 : (coastNext - coastHere) / (coastU[1] as number);
  const [cx, cdz, wc, wp] = coast as [number, number, number, number];
  const d = px - cx;
  const column = (d - OCEAN_D_MIN) / OCEAN_D_STEP;
  const deep = Math.min(d - OCEAN_D_MIN, 0);
  const bay = read(OCEAN_ROW_BAY_PROFILE, column);
  const cove = read(OCEAN_ROW_COVE_PROFILE, column);
  const h = (bay[0] as number) + ((cove[0] as number) - (bay[0] as number)) * wc;
  const a = (bay[1] as number) + ((cove[1] as number) - (bay[1] as number)) * wc;
  const b = (bay[2] as number) + ((cove[2] as number) - (bay[2] as number)) * wc;
  const shelter = shelterTip(px, pz, tips[0] as [number, number], SHELTER_SWELL) * shelterTip(px, pz, tips[1] as [number, number], SHELTER_SWELL);
  const phi: number[] = [];
  const amp: number[] = [];
  const q0: number[] = [];
  const kv: [number, number][] = [];
  let ex = 0;
  let ey = 0;
  for (let c = 0; c < 12; c++) {
    if (c >= (coastU[2] as number)) break;
    const k = texel(OCEAN_ROW_COMPONENTS, 2 * c) as [number, number, number, number];
    const rb = read(OCEAN_ROW_BAY_FIRST + c, column) as [number, number, number, number];
    const rc = read(OCEAN_ROW_COVE_FIRST + c, column) as [number, number, number, number];
    const dpsi = rc[0] - rb[0];
    const psi = rb[0] + dpsi * wp + k[0] * deep;
    const kn = rb[1] + (rc[1] - rb[1]) * wp;
    const shoal = rb[2] + (rc[2] - rb[2]) * wc;
    phi[c] = psi + k[0] * cx + k[1] * pz + (phases[c] as number);
    kv[c] = [kn, k[1] + (k[0] - kn) * cdz + dpsi * phaseDz];
    amp[c] = k[3] * shoal * shelter;
    q0[c] = texel(OCEAN_ROW_COMPONENTS, 2 * c + 1)[0] as number;
    ex += (amp[c] as number) * Math.cos(phi[c] as number);
    ey += (amp[c] as number) * Math.sin(phi[c] as number);
  }
  const envelope = Math.hypot(ex, ey);
  const unbroken = 2 * envelope;
  const crestPhase = envelope > 0 ? Math.atan2(ey, ex) : 0;
  const hc = Math.max(h, OCEAN_DRY_DEPTH);
  const gamma = Math.min(WEGGEL_GAMMA_MAX, Math.max(WEGGEL_GAMMA_MIN, b - (a * unbroken) / (OCEAN_G * (swell[2] as number) * (swell[2] as number))));
  const ratio = unbroken / (gamma * hc);
  let scale = 1;
  if (ratio > 1) {
    const cap = gamma + (OCEAN_BORE_RATIO - gamma) * smoothstep(1, OCEAN_BREAK_FULL, ratio);
    scale = (hc * cap) / Math.max(unbroken, 1e-6);
  }
  const breaking = smoothstep(OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FOAM_HI, ratio);
  let steepness = 0;
  for (let c = 0; c < 12; c++) {
    if (c >= (coastU[2] as number)) break;
    amp[c] = (amp[c] as number) * scale;
    steepness += (q0[c] as number) * Math.hypot(...(kv[c] as [number, number])) * (amp[c] as number);
  }
  const s = Math.min(1, SWELL_Q_SUM_MAX / Math.max(steepness, 1e-6));
  let height = 0;
  let dx = 0;
  let dz = 0;
  let slopeX = 0;
  let slopeZ = 0;
  let fold = 0;
  let drawn = 0;
  for (let c = 0; c < 12; c++) {
    if (c >= (coastU[2] as number)) break;
    const [kx, kz] = kv[c] as [number, number];
    const kmag = Math.hypot(kx, kz);
    const turn = Math.max(Math.abs(dpx[0] * kx + dpx[1] * kz), Math.abs(dpy[0] * kx + dpy[1] * kz));
    const A = (amp[c] as number) * (1 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, turn));
    const Q = (q0[c] as number) * s;
    const sn = Math.sin(phi[c] as number);
    const cs = Math.cos(phi[c] as number);
    height += A * cs;
    dx -= (Q * A * kx * sn) / kmag;
    dz -= (Q * A * kz * sn) / kmag;
    slopeX += A * kx * sn;
    slopeZ += A * kz * sn;
    fold += Q * A * kmag * cs;
    drawn += 0.5 * (A * kmag) * (A * kmag);
  }
  const foamAge = mod(-crestPhase, 2 * Math.PI) / ((2 * Math.PI) / (swell[2] as number));
  const roll = breaking * (1 - smoothstep(0, OCEAN_ROLL_WIDTH, mod(crestPhase, 2 * Math.PI)));
  const trailing = breaking * Math.exp(-foamAge / OCEAN_FOAM_LIFE);
  return {
    height, dx, dz, slopeX, slopeZ, normalY: 1 - fold, depth: h, breaking, foamAge,
    foam: Math.max(roll, trailing, breaking * OCEAN_INNER_FOAM), drawn,
  };
}

describe("the sea's shader constants and functions", () => {
  it("hold the TypeScript's values", () => {
    const s = fx("oceanSurface.fx");
    const surface: [string, number][] = [
      ["OCEAN_G", OCEAN_G], ["OCEAN_TWO_PI", 2 * Math.PI], ["OCEAN_D_MIN", OCEAN_D_MIN], ["OCEAN_D_STEP", OCEAN_D_STEP],
      ["OCEAN_TABLE_SAMPLES", OCEAN_TABLE_SAMPLES], ["OCEAN_ATLAS_ROWS", OCEAN_ATLAS_ROWS],
      ["OCEAN_ROW_BAY_PROFILE", OCEAN_ROW_BAY_PROFILE], ["OCEAN_ROW_COVE_PROFILE", OCEAN_ROW_COVE_PROFILE],
      ["OCEAN_ROW_BAY_FIRST", OCEAN_ROW_BAY_FIRST], ["OCEAN_ROW_COVE_FIRST", OCEAN_ROW_COVE_FIRST],
      ["OCEAN_ROW_COMPONENTS", OCEAN_ROW_COMPONENTS], ["OCEAN_ROW_COAST", OCEAN_ROW_COAST],
      ["OCEAN_DRY_DEPTH", OCEAN_DRY_DEPTH], ["WEGGEL_GAMMA_MIN", WEGGEL_GAMMA_MIN], ["WEGGEL_GAMMA_MAX", WEGGEL_GAMMA_MAX],
      ["SWELL_Q_SUM_MAX", SWELL_Q_SUM_MAX], ["OCEAN_BORE_RATIO", OCEAN_BORE_RATIO], ["OCEAN_BREAK_FULL", OCEAN_BREAK_FULL],
      ["OCEAN_BREAK_FOAM_LO", OCEAN_BREAK_FOAM_LO], ["OCEAN_BREAK_FOAM_HI", OCEAN_BREAK_FOAM_HI],
      ["OCEAN_FOAM_LIFE", OCEAN_FOAM_LIFE], ["OCEAN_ROLL_WIDTH", OCEAN_ROLL_WIDTH], ["OCEAN_INNER_FOAM", OCEAN_INNER_FOAM],
      ["SHELTER_SWELL", SHELTER_SWELL], ["SHELTER_CHOP", SHELTER_CHOP], ["SHELTER_WIDTH", SHELTER_WIDTH],
      ["OCEAN_RESOLVE_PHASE_LO", OCEAN_RESOLVE_PHASE_LO], ["OCEAN_RESOLVE_PHASE_HI", OCEAN_RESOLVE_PHASE_HI],
      ["OCEAN_RING_BASE", WATER_BASE_SPACING], ["OCEAN_RING_REACH", WATER_RING_CELLS / 4],
    ];
    for (const [name, value] of surface) pinned(s, name, value);
    const f = fx("oceanShade.fragment.fx");
    pinned(f, "WATER_COX_MUNK_A", WATER_COX_MUNK_A);
    pinned(f, "WATER_COX_MUNK_B", WATER_COX_MUNK_B);
    pinned(f, "OCEAN_SLOPE_VAR_FLOOR", OCEAN_SLOPE_VAR_FLOOR);
  });

  it("declares the sea's functions under OCEAN alone, the coastline's named apart from the oceanCoast uniform", () => {
    const s = fx("oceanSurface.fx");
    for (const signature of [
      "vec4 oceanAtlasRow(float row, float d)",
      "vec4 oceanCoastAt(float z, out float phaseDz)",
      "float oceanShelter(vec2 p, float keep)",
      "void oceanSwellEval(vec2 p, out vec3 disp, out vec3 normal, out vec4 foam)",
      "void oceanSwellSum(vec2 p, vec2 dpx, vec2 dpy, out vec3 disp, out vec3 normal, out vec4 foam, out float drawn)",
      "float oceanRingCell(vec2 p)",
      "vec3 oceanDisplace(vec2 p)",
    ]) expect(s).toContain(signature);
    expect(s).not.toMatch(/\boceanCoast\s*\(/);
    // Every line, comments too, inside the gate: a lake's definitions carry none of it.
    for (const name of ["oceanSurface.fx", "oceanShade.fragment.fx"]) {
      expect(fx(name).startsWith("#ifdef OCEAN\n"), name).toBe(true);
      expect(fx(name).endsWith("#endif\n"), name).toBe(true);
    }
  });

  it("reads every texture at a fixed level, in loops bounded by a constant and broken on the uniform count", () => {
    for (const name of ["oceanSurface.fx", "oceanShade.fragment.fx", "oceanDisplace.vertex.fx"]) {
      expect(fx(name), name).not.toMatch(/\btexture2D\s*\(|\btexture\s*\(/);
    }
    const s = fx("oceanSurface.fx");
    expect(s).toContain("return textureLod(oceanAtlas, vec2((column + 0.5) / OCEAN_TABLE_SAMPLES, (row + 0.5) / OCEAN_ATLAS_ROWS), 0.0);");
    expect(s.match(/for \(int c = 0; c < 12; c\+\+\) \{/g)).toHaveLength(3);
    expect(s.match(/if \(fc >= oceanCoast\.z\) break;/g)).toHaveLength(1);
    expect(s.match(/if \(float\(c\) >= oceanCoast\.z\) break;/g)).toHaveLength(2);
    // Every read of the atlas is a textureLod at level 0, and there is no other texture call in the file.
    expect(s.match(/\btextureLod\(/g)).toHaveLength(1);
    expect(s.match(/\btexture\w*\(/g)).toHaveLength(1);
  });

  it("writes swellAt's sum: the phase, the wave vector, the dry rule, the cap, the Gerstner normal, the foam", () => {
    const s = fx("oceanSurface.fx");
    for (const line of [
      "  return a + (b - a) * (c - i0);",
      // oceanCoastAt, coastRead's five values: the row's four channels, and the phase weight's slope along z
      "  float column = (z - oceanCoast.x) / oceanCoast.y;",
      "  vec4 a = oceanAtlasTexel(OCEAN_ROW_COAST, i0);",
      "  vec4 b = oceanAtlasTexel(OCEAN_ROW_COAST, min(i0 + 1.0, OCEAN_TABLE_SAMPLES - 1.0));",
      "  phaseDz = column < 0.0 ? 0.0 : (b.w - a.w) / oceanCoast.y;",
      "  float side = u.y >= 0.0 ? 1.0 : -1.0;",
      "  float on = step(0.0, dot(u, r)) * step(0.0, r.y * side);",
      "  float lambda = -(u.x * r.y - u.y * r.x) * side;",
      "  float phaseDz;",
      "  vec4 coast = oceanCoastAt(p.y, phaseDz);",
      "  float h = bay.x + (cove.x - bay.x) * coast.z;",
      "  float a = bay.y + (cove.y - bay.y) * coast.z;",
      "  float b = bay.z + (cove.z - bay.z) * coast.z;",
      // the phase and its onshore wavenumber blend by the phase weight, the rest by the cove's
      "    float dpsi = rc.x - rb.x;",
      "    float psi = rb.x + dpsi * coast.w + k.x * deep;",
      "    float kn = rb.y + (rc.y - rb.y) * coast.w;",
      "    float shoal = rb.z + (rc.z - rb.z) * coast.z;",
      "    phi[c] = psi + k.x * coast.x + k.y * p.y + theta[c];",
      "    kv[c] = vec2(kn, k.y + (k.x - kn) * coast.y + dpsi * phaseDz);",
      "    amp[c] = k.w * shoal * shelter;",
      "    q0[c] = oceanAtlasTexel(OCEAN_ROW_COMPONENTS, 2.0 * fc + 1.0).x;",
      "  float hc = max(h, OCEAN_DRY_DEPTH);",
      "  float ratio = unbroken / (gamma * hc);",
      "    scale = hc * cap / max(unbroken, 1.0e-6);",
      "  float s = min(1.0, SWELL_Q_SUM_MAX / max(steepness, 1.0e-6));",
      "    across -= Q * A * kv[c] * sn / kmag;",
      "  normal = normalize(vec3(slope.x, 1.0 - fold, slope.y));",
      "  foam = vec4(max(max(roll, trailing), breaking * OCEAN_INNER_FOAM), breaking, foamAge, h);",
    ]) expect(s, line).toContain(line);
    // The atlas read and the coastline read both end in the same mix of two texels.
    expect(s.match(/return a \+ \(b - a\) \* \(c - i0\);/g)).toHaveLength(2);
    // No branch on the depth: the dry rule holds the depth instead.
    expect(s).not.toContain("if (h > OCEAN_DRY_DEPTH)");
  });

  it("gives swellAt's numbers, transcribed line for line, at 1,275 points over three worlds, and fades only what is drawn", () => {
    let broken = 0;
    for (const seed of [SEED, 12345, 777]) {
      const field = oceanFieldFor(seed);
      const phases = swellPhases(field, 37.5);
      const coastline = coastProfilesFor(seed).coastlineX;
      for (let i = 0; i <= 24; i++) {
        for (let j = 0; j <= 16; j++) {
          const z = -400 + j * 50;
          const x = coastline(z) - 700 + i * 30;
          const want = swellAt(field, phases, x, z);
          const got = shaderSwell(field, phases, x, z, [0, 0], [0, 0]);
          for (const key of ["height", "dx", "dz", "slopeX", "slopeZ", "normalY", "depth", "breaking", "foamAge", "foam"] as const) {
            expect(Math.abs(got[key] - want[key]), `${key} at (${x}, ${z})`).toBeLessThan(1e-9);
          }
          if (want.breaking > 0.5) broken++;
          // A step of a kilometre fades every component out of what is drawn, never the break or its foam.
          const far = shaderSwell(field, phases, x, z, [1000, 0], [0, 1000]);
          expect(far.height).toBe(0);
          expect(far.slopeX).toBe(0);
          expect(far.drawn).toBe(0);
          expect(far.breaking).toBe(got.breaking);
          expect(far.foam).toBe(got.foam);
        }
      }
    }
    // The points cross the break line: some of them break.
    expect(broken).toBeGreaterThan(100);
  }, timeLimit(60_000));

  it("estimates a vertex's ring from its distance alone: its own spacing at the inner edge, the next ring's at the outer", () => {
    expect(OCEAN_RING_REACH).toBe(32);
    expect(oceanRingCell(0, 0)).toBe(WATER_BASE_SPACING);
    for (let level = 1; level < WATER_RING_COUNT; level++) {
      const spacing = waterRingSpacing(level);
      expect(oceanRingCell(32 * spacing, -5)).toBe(spacing);
      expect(oceanRingCell(-3, 64 * spacing)).toBe(2 * spacing);
    }
    expect(fx("oceanSurface.fx")).toContain("  return max(OCEAN_RING_BASE, max(r.x, r.y) / OCEAN_RING_REACH);");
  });

  it("displaces in UPDATE_POSITION once, at the vertex slid toward the coarser ring's lattice, the point it shades", () => {
    const d = fx("oceanDisplace.vertex.fx");
    const slide = at(d, "positionUpdated.xz -= oceanMorph * oceanCoarse;");
    const assign = at(d, "vOceanXZ = positionUpdated.xz;");
    const displace = at(d, "positionUpdated += oceanDisplace(positionUpdated.xz);");
    expect(slide).toBeLessThan(assign);
    expect(assign).toBeLessThan(displace);
    expect(d.match(/oceanDisplace\(/g)).toHaveLength(1);
    // The ring's normal is left up: the sea's normal is made per pixel.
    expect(d).not.toContain("normalUpdated");
    // Each ring fades the swell at four of its cells a wavelength.
    expect(fx("oceanSurface.fx")).toContain("  oceanSwellSum(p, vec2(2.0 * cell, 0.0), vec2(0.0, 2.0 * cell), disp, normal, foam, drawn);");
  });
});

describe("the sea's normal, waterline and roughness", () => {
  it("takes the swell's derivatives in uniform control flow, before any branch, and its depth under the displaced surface", () => {
    const l = fx("waterLights.fragment.fx");
    const top = l.slice(0, at(l, "vec2 wOceanDx = dFdx(vOceanXZ);"));
    expect(top.split("{").length).toBe(top.split("}").length);
    expect(l).toContain("vec2 wOceanDy = dFdy(vOceanXZ);");
    expect(l).toContain("oceanSwellSum(vOceanXZ, wOceanDx, wOceanDy, wOceanDisp, wOceanNormal, wOceanFoam, wOceanDrawn);");
    expect(l).toContain("float wDepth = waterBedDepth(vPositionW.xz) + wOceanDisp.y;");
    expect(at(l, "float wDepth = waterBedDepth(vPositionW.xz) + wOceanDisp.y;")).toBeLessThan(at(l, "if (wDepth <= 0.0) discard;"));
  });

  it("puts the swell's normal before the rain's rings, the horizon clamp and Fresnel, and the second octave off the sea", () => {
    const l = fx("waterLights.fragment.fx");
    const swell = at(l, "normalW = normalize(wOceanNormal + vec3(wOceanExtra.x, 0.0, wOceanExtra.y) * wOceanNormal.y);");
    expect(swell).toBeLessThan(at(l, "if (waterRain > 0.0) {"));
    expect(swell).toBeLessThan(at(l, "normalW = waterHorizonNormal(normalW, viewDirectionW);"));
    expect(swell).toBeLessThan(at(l, "float wF = WATER_F0"));
    // The ripple's block sits in the gate's other branch: never on the sea, unchanged on a lake.
    expect(at(l, "if (waterOctaves > 1.5) {")).toBeGreaterThan(swell);
    expect(l.slice(swell, at(l, "if (waterOctaves > 1.5) {"))).toContain("#else");
  });

  it("is Cox and Munk's variance for the wind less what the drawn waves carry, never under the floor", () => {
    expect(coxMunkVariance(10)).toBeCloseTo(0.0542, 12);
    expect(slopeVariance(10 / 12, 1)).toBeCloseTo(coxMunkVariance(10), 12);
    expect(undrawnSlopeVariance(10, 1, 0)).toBeCloseTo(0.0542, 12);
    expect(undrawnSlopeVariance(10, 1, 0.02)).toBeCloseTo(0.0342, 12);
    expect(undrawnSlopeVariance(10, 0.15, 0)).toBeCloseTo(0.00813, 12);
    expect(undrawnSlopeVariance(0, 1, 0.01)).toBe(OCEAN_SLOPE_VAR_FLOOR);
    expect(roughnessFromVariance(0.0542)).toBeCloseTo(0.5737957, 6);
    expect(roughnessFromVariance(OCEAN_SLOPE_VAR_FLOOR)).toBeCloseTo(0.2340347, 6);
    expect(roughnessFromVariance(slopeVariance(0.5, 1))).toBeCloseTo(roughnessFor(0.5, 1), 12);
    expect(roughnessFromVariance(10)).toBe(1);
    expect(fx("oceanShade.fragment.fx")).toContain("  return max((WATER_COX_MUNK_A + WATER_COX_MUNK_B * u10) * shelter - drawn, OCEAN_SLOPE_VAR_FLOOR);");
    expect(fx("waterLights.fragment.fx")).toContain("float wOceanVar = oceanUndrawnVariance(oceanWindDir.z, wOceanChop, wOceanDrawn);");
  });

  it("fades a drawn wave between four steps a wavelength and two, its variance moving to the roughness", () => {
    expect(resolvedShare(0)).toBe(1);
    expect(resolvedShare(Math.PI / 2)).toBe(1);
    expect(resolvedShare(0.75 * Math.PI)).toBeCloseTo(0.5, 12);
    expect(resolvedShare(Math.PI)).toBe(0);
    const wave = [{ amplitude: 0.5, k: 0.1 }];
    expect(resolvedSlopeVariance(wave, 0)).toBeCloseTo(0.00125, 12);
    expect(resolvedSlopeVariance(wave, 7.5 * Math.PI)).toBeCloseTo(0.0003125, 12);
    expect(resolvedSlopeVariance(wave, 10 * Math.PI)).toBe(0);
  });

  it("reads the roughness at Babylon's one roughness line, on the sea alone", () => {
    expect(OCEAN_ROUGHNESS_ANCHOR).toBe("!float roughness=reflectivityOut\\.roughness;");
    expect(OCEAN_ROUGHNESS_CODE).toBe("float roughness=min(sqrt(sqrt(2.0 * wOceanVar)), 1.0);");
    // A canary on the installed Babylon: the line is there, once.
    const pbr = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Shaders/pbr.fragment.js"), "utf8");
    expect(pbr.match(new RegExp(OCEAN_ROUGHNESS_ANCHOR.slice(1), "g"))).toHaveLength(1);
    const engine = new NullEngine();
    try {
      const scene = new Scene(engine);
      const sea = attachWater(new PBRMaterial("sea", scene), WATER_ROWS.sea);
      const lake = attachWater(new PBRMaterial("lake", scene), WATER_ROWS.lowlandLake);
      sea.ocean = bindingFor(scene, "medium");
      expect(sea.getCustomCode("fragment")![OCEAN_ROUGHNESS_ANCHOR]).toBe(OCEAN_ROUGHNESS_CODE);
      // An empty string injects nothing: the lake's line stays Babylon's own.
      expect(lake.getCustomCode("fragment")![OCEAN_ROUGHNESS_ANCHOR]).toBe("");
    } finally {
      engine.dispose();
    }
  }, timeLimit(30_000));
});

describe("a lake's shaders", () => {
  it("process to the text they had before the sea moved", async () => {
    // Each hook through Babylon's preprocessor with a lake's gates, hashed as it was at 9edee7e.
    const before: Record<string, string> = {
      "water.vertex.fx": "3732482554b89e357fec2298edc8724ad085cc9defe35017b243df6b7782d50b",
      "waterWorldPos.vertex.fx": "d5bb8eb0b5c8047604fd2f58f00894c3968a427b29fa74daa73691917583dde3",
      "water.fragment.fx": "6c7a3933162a07f97a51c848e5f7cf34bd5095aa3c3778f2df0f1a0020808964",
      "waterLights.fragment.fx": "e43c7dd65420563ad94555469e69b237229563a6cf07e4ea5f86b53e73a1c5cb",
      "waterCompose.fragment.fx": "a3cdf837137ae07cea47e0facfbc0b6ad44269d7a723b9f157e487da0cf34447",
    };
    for (const [name, hash] of Object.entries(before)) {
      expect(sha256(await processed(fx(name), !name.includes(".vertex."))), name).toBe(hash);
    }
  });

  it("carry none of the sea's text: its definitions vanish under a lake's gates", async () => {
    const engine = new NullEngine();
    try {
      const lake = attachWater(new PBRMaterial("lake", new Scene(engine)), WATER_ROWS.lowlandLake);
      const v = lake.getCustomCode("vertex")!;
      const f = lake.getCustomCode("fragment")!;
      expect(await processed(v.CUSTOM_VERTEX_DEFINITIONS!, false)).toBe(await processed(fx("water.vertex.fx"), false));
      expect(await processed(f.CUSTOM_FRAGMENT_DEFINITIONS!, true)).toBe(await processed(fx("water.fragment.fx"), true));
    } finally {
      engine.dispose();
    }
  });
});

describe("the water material's stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => {
    translators = await startTranslators();
  }, timeLimit(60_000));

  const translated = (effect: ProcessedEffect, defines: string): { vertex: string; fragment: string } => {
    const stage = (kind: "vertex" | "fragment", code: string): string =>
      translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
    return { vertex: stage("vertex", effect._vertexSourceCode), fragment: stage("fragment", effect._fragmentSourceCode) };
  };

  for (const tier of ["high", "medium", "low"] as const) {
    it(`compile through glslang and translate to WGSL for the sea on the ${tier} tier, its textures read at a fixed level, in order`, async () => {
      const sea = await waterEffect(tier);
      try {
        const { effect, defines } = sea;
        expect(defines).toContain("#define OCEAN");
        expect(defines.split("\n").includes("#define BUMP")).toBe(tier === "low");
        const v = effect._vertexSourceCode;
        const f = effect._fragmentSourceCode;
        // The displacement before worldPos, so it reaches the position, vPositionW and the view depth.
        const displaced = at(v, "positionUpdated += oceanDisplace(positionUpdated.xz);");
        expect(displaced).toBeGreaterThan(at(v, "vOceanXZ = positionUpdated.xz;"));
        expect(at(v, "vOceanXZ = positionUpdated.xz;")).toBeGreaterThan(at(v, "positionUpdated.xz -= oceanMorph * oceanCoarse;"));
        expect(displaced).toBeLessThan(at(v, "vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);"));
        // The swell's normal and the variance it leaves, then the rain's rings, the horizon clamp and
        // Fresnel; Babylon's roughness line, rewritten, after them all.
        const order = [
          "oceanSwellSum(vOceanXZ, wOceanDx, wOceanDy",
          "normalW = normalize(wOceanNormal",
          "float wOceanVar =",
          "if (waterRain > 0.0) {",
          "normalW = waterHorizonNormal(normalW, viewDirectionW);",
          "float wF = WATER_F0",
          OCEAN_ROUGHNESS_CODE,
        ].map((needle) => at(f, needle));
        for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1] as number);
        expect(f).not.toContain("float roughness=reflectivityOut.roughness;");
        expect(f).not.toContain("waterRipple2(vPositionW.xz)");
        // A stage that does not parse throws here, with glslang's message on stderr.
        const { vertex, fragment } = translated(effect, defines);
        expect(vertex).toContain("oceanAtlas");
        expect(vertex).toContain("oceanSwellSum");
        // WGSL allows no implicit-derivative sample in a vertex stage.
        expect(vertex).toMatch(/textureSampleLevel\(/);
        expect(vertex).not.toMatch(/textureSample\(/);
        // And the fragment stage reads the sea's textures at a fixed level only, so no read of theirs can
        // stand in non-uniform control flow.
        expect(fragment).toMatch(/textureSampleLevel\(\s*oceanAtlasTexture/);
        expect(fragment).not.toMatch(/textureSample(?:Bias|Grad|Compare)?\(\s*ocean/);
        expect(fragment).toContain("oceanSwellSum");
        expect(fragment).toContain("oceanFoamCover");
        expect(fragment).toContain("oceanLaceLevel");
        expect(fragment).toContain("oceanCapCells");
        expect(fragment).toContain("oceanCapFire");
      } finally {
        sea.dispose();
      }
    }, timeLimit(120_000));
  }

  it("leave a lake's roughness line, its ripples and its vertices as they were", async () => {
    const lake = await waterEffect("medium", true);
    try {
      const f = lake.effect._fragmentSourceCode;
      expect(lake.defines).not.toContain("#define OCEAN");
      expect(f).toContain("float roughness=reflectivityOut.roughness;");
      expect(f).toContain("waterRipple2(vPositionW.xz)");
      expect(f).not.toContain("wOcean");
      expect(lake.effect._vertexSourceCode).not.toContain("oceanDisplace");
      translated(lake.effect, lake.defines);
    } finally {
      lake.dispose();
    }
  }, timeLimit(60_000));
});

describe("the white water", () => {
  it("holds the TypeScript's look, lace and cap numbers", () => {
    const f = fx("oceanShade.fragment.fx");
    const look: [string, number][] = [
      ["OCEAN_FOAM_ALBEDO", OCEAN_FOAM_ALBEDO], ["OCEAN_FOAM_ALBEDO_OLD", OCEAN_FOAM_ALBEDO_OLD],
      ["OCEAN_FOAM_FADE", OCEAN_FOAM_FADE], ["OCEAN_INNER_COVER", OCEAN_INNER_COVER],
      ["OCEAN_LACE_TILE", OCEAN_LACE_TILE], ["OCEAN_LACE_DRIFT", OCEAN_LACE_DRIFT], ["OCEAN_LACE_SOFT", OCEAN_LACE_SOFT],
      ["OCEAN_LACE_WEIGHT", OCEAN_LACE_WEIGHT], ["OCEAN_LACE_FINE", OCEAN_LACE_FINE],
      ["OCEAN_LACE_FINE_SHIFT", OCEAN_LACE_FINE_SHIFT], ["OCEAN_LACE_FIT_A", OCEAN_LACE_FIT_A],
      ["OCEAN_LACE_FIT_B", OCEAN_LACE_FIT_B], ["OCEAN_LACE_FIT_C", OCEAN_LACE_FIT_C], ["OCEAN_LACE_FIT_D", OCEAN_LACE_FIT_D],
      ["OCEAN_LACE_FIT_E", OCEAN_LACE_FIT_E],
      ["OCEAN_LACE_ONSET", OCEAN_LACE_ONSET], ["OCEAN_DETAIL_LO", OCEAN_DETAIL_LO], ["OCEAN_DETAIL_HI", OCEAN_DETAIL_HI],
      ["OCEAN_CAP_CELL", OCEAN_CAP_CELL], ["OCEAN_CAP_PERIOD", OCEAN_CAP_PERIOD], ["OCEAN_CAP_RADIUS", OCEAN_CAP_RADIUS],
      ["OCEAN_CAP_INSET", OCEAN_CAP_INSET], ["OCEAN_CAP_DRIFT", OCEAN_CAP_DRIFT], ["OCEAN_CAP_SHARE", OCEAN_CAP_SHARE],
      ["OCEAN_CAP_CYCLES", OCEAN_CAP_CYCLES], ["OCEAN_CAP_SOFT", OCEAN_CAP_SOFT],
    ];
    for (const [name, value] of look) pinned(f, name, value);
    for (const signature of [
      "float oceanLace(vec2 p)", "float oceanFoamLookAge(float foamAge)", "float oceanFoamShare(float foam, float breaking)",
      "float oceanLaceLevel(float share)", "float oceanFoamCover(vec2 p, float foam, float breaking, float pixel)",
      "float oceanFoamWhite(float lookAge)", "float oceanCapCoverage(vec2 p)", "float oceanCapThreshold(float coverage)",
      "float oceanWhitecap(vec2 p, float crest)", "float oceanCapFire(vec2 h, float k, float chance)",
      "float oceanCapCells(vec2 p, float pixel)",
    ]) expect(f).toContain(signature);
  });

  it("keeps the lace's noise and its hash the TypeScript mirror's, line for line", () => {
    const f = fx("oceanShade.fragment.fx");
    for (const line of [
      "  float a = 1.0 - abs(2.0 * waterSkinNoise(q / OCEAN_LACE_TILE) - 1.0);",
      "  float b = 1.0 - abs(2.0 * waterSkinNoise(q / (OCEAN_LACE_FINE * OCEAN_LACE_TILE) + OCEAN_LACE_FINE_SHIFT) - 1.0);",
      "  return OCEAN_LACE_WEIGHT * a + (1.0 - OCEAN_LACE_WEIGHT) * b;",
    ]) expect(f).toContain(line);
    // The water's own hash and noise, which the lace and the caps reuse: waterShading.ts mirrors these lines.
    const w = fx("water.fragment.fx");
    for (const line of [
      "  vec3 p3 = fract(vec3(p.xyx) * 0.1031);",
      "  p3 += dot(p3, p3.yzx + 33.33);",
      "  return fract((p3.x + p3.y) * p3.z);",
      "  vec2 u = f * f * (3.0 - 2.0 * f);",
      "  float b = waterSkinHash(i + vec2(1.0, 0.0));",
      "  float c = waterSkinHash(i + vec2(0.0, 1.0));",
      "  float d = waterSkinHash(i + vec2(1.0, 1.0));",
      "  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);",
    ]) expect(w).toContain(line);
  });

  it("whitens fresh foam to 0.4 and old foam toward 0.06 by its age, and covers the foam's amount of the surface through a lace", () => {
    expect(foamWhite(0)).toBeCloseTo(0.4, 12);
    expect(foamWhite(10)).toBeCloseTo(0.1004995, 6);
    expect(foamWhite(1000)).toBeCloseTo(0.06, 9);
    const f = fx("oceanShade.fragment.fx");
    // The share (the foam's amount or the inner surf's floor, which the bores renew and which never thins with age),
    // the level that leaves it, the lace above the level through a soft edge centred on it, held back as the share
    // goes to none, and the share itself where a pixel spans more than a few of the lace's cells.
    for (const line of [
      "  return max(foam, breaking * OCEAN_INNER_COVER);",
      "  float c = clamp(share, 0.0, 1.0);",
      "  float s = sqrt(c);",
      "  float p = 1.0 - sqrt(sqrt(1.0 - c));",
      "  return 1.0 - s * (OCEAN_LACE_FIT_A + s * (OCEAN_LACE_FIT_B + s * OCEAN_LACE_FIT_C)) - p * (OCEAN_LACE_FIT_D + p * OCEAN_LACE_FIT_E);",
      "  float lace = smoothstep(level - 0.5 * OCEAN_LACE_SOFT, level + 0.5 * OCEAN_LACE_SOFT, oceanLace(p)) * smoothstep(0.0, OCEAN_LACE_ONSET, share);",
      "  return mix(lace, share, smoothstep(OCEAN_DETAIL_LO, OCEAN_DETAIL_HI, pixel / OCEAN_LACE_TILE));",
      "  return mix(OCEAN_FOAM_ALBEDO_OLD, OCEAN_FOAM_ALBEDO, exp(-lookAge / OCEAN_FOAM_FADE));",
    ]) expect(f).toContain(line);
    // The roll on the crest's front face is fresh: the age is the swell's less the phase the roll spans.
    expect(f).toContain("  float ahead = OCEAN_TWO_PI - foamAge * (OCEAN_TWO_PI / oceanSwell.z);");
    expect(f).toContain("  return foamAge * smoothstep(0.0, OCEAN_ROLL_WIDTH, ahead);");
    // The lace drifts with the swell's travel and is offset by the world's seed, the sea's waterSkin.y.
    expect(f).toContain("  vec2 q = p + waterSkin.y - oceanSwell.xy * (OCEAN_LACE_DRIFT * waterTime);");
    expect(f).not.toContain("1.0 - foam + OCEAN_LACE_SOFT");
    // The cover has no age in it: the albedo alone fades with the foam's age.
    expect(f).not.toContain("OCEAN_LACE_THIN");
    expect(f).not.toContain("OCEAN_FOAM_REFLECT_FRESH");
  });

  it("puts the whitecaps over Callaghan's share of a Gaussian sea's crests", () => {
    expect(Math.abs(whitecapThreshold(0.1) - 1.28155)).toBeLessThan(1e-3);
    expect(Math.abs(whitecapThreshold(0.01) - 2.32635)).toBeLessThan(1e-3);
    expect(Math.abs(whitecapThreshold(0.001) - 3.09023)).toBeLessThan(1e-3);
    expect(Math.abs(whitecapThreshold(0.5))).toBeLessThan(1e-3);
    expect(fx("oceanShade.fragment.fx")).toContain(
      "  return s - (2.515517 + 0.802853 * s + 0.010328 * s * s) / (1.0 + 1.432788 * s + 0.189269 * s * s + 0.001308 * s * s * s);",
    );
  });

  it("gives the low tier's cells Callaghan's coverage by construction: a fired cap covers OCEAN_CAP_SHARE of its cell", () => {
    // The cap's profile over its cell by the midpoint rule, times its mean brightness over a cycle.
    const n = 1000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = (i + 0.5) / n - 0.5;
        const z = (j + 0.5) / n - 0.5;
        sum += capProfile(Math.hypot(x, z) / OCEAN_CAP_RADIUS);
      }
    }
    expect(Math.abs((sum / (n * n)) * 0.5 - OCEAN_CAP_SHARE)).toBeLessThan(1e-4);
    // A cap stays inside its cell: its centre is inset by at least its radius.
    expect(OCEAN_CAP_INSET).toBeGreaterThanOrEqual(OCEAN_CAP_RADIUS);
    // A fired cap's chance, coverage over the share, is a chance: the wind's greatest coverage stays under it.
    expect(WHITECAP_MAX).toBeLessThanOrEqual(OCEAN_CAP_SHARE);
  });

  it("draws the cells' caps from a hash fresh every cycle, a strict chance, the coverage at the cap's centre and a clock that folds by the pattern's repeat", () => {
    const f = fx("oceanShade.fragment.fx");
    for (const line of [
      "  float n = mod(k, OCEAN_CAP_CYCLES);",
      "  vec2 shift = vec2(waterSkinHash(vec2(n, 31.0)), waterSkinHash(vec2(n, 77.0))) * 512.0;",
      "  return 1.0 - step(chance, waterSkinHash(h + shift));",
      "  vec2 q = (p + waterSkin.y - waterWindTime * OCEAN_CAP_DRIFT) / OCEAN_CAP_CELL;",
      "  vec2 centre = vec2(waterSkinHash(h + vec2(13.0, 0.0)), waterSkinHash(h + vec2(0.0, 57.0))) * (1.0 - 2.0 * OCEAN_CAP_INSET) + OCEAN_CAP_INSET;",
      "  vec2 at = (c + centre) * OCEAN_CAP_CELL - waterSkin.y + waterWindTime * OCEAN_CAP_DRIFT;",
      "  float cycle = mod(waterTime, OCEAN_CAP_CYCLES * OCEAN_CAP_PERIOD) / OCEAN_CAP_PERIOD + waterSkinHash(h);",
      "  float fire = oceanCapFire(h, k, oceanCapCoverage(at) / OCEAN_CAP_SHARE);",
      "  float cap = fire * (1.0 - (cycle - k)) * (1.0 - smoothstep(0.7, 1.0, r));",
      "  return mix(cap, oceanCapCoverage(p), smoothstep(OCEAN_DETAIL_LO, OCEAN_DETAIL_HI, pixel / (2.0 * OCEAN_CAP_RADIUS * OCEAN_CAP_CELL)));",
    ]) expect(f).toContain(line);
    // Not the hash that stepped by a whole cell a cycle, the hour's fold, or a hash that fires at a chance of none.
    expect(f).not.toContain("mod(k, 97.0) * 3.0");
    expect(f).not.toContain("mod(waterTime, 3600.0)");
    expect(f).not.toContain("float fire = step(");
  });

  it("lays the white water over the sea as the skin lies over a lake: after the transmission, matte in the compose", () => {
    const l = fx("waterLights.fragment.fx");
    const layer = at(l, "float wFoam = max(wOceanLace, wOceanCap);");
    expect(layer).toBeGreaterThan(at(l, "if (waterSkin.x > 0.0) {"));
    expect(layer).toBeGreaterThan(at(l, "wTransmit = wBed * wT * (1.0 - wF);"));
    // The swell's foam through its lace, and the caps, which the broken waves eat, both faded by the pixel's span.
    expect(at(l, "float wOceanPixel = max(length(wOceanDx), length(wOceanDy));")).toBeLessThan(layer);
    expect(at(l, "float wFoamAge = oceanFoamLookAge(wOceanFoam.z);")).toBeLessThan(layer);
    expect(at(l, "float wOceanLace = oceanFoamCover(vOceanXZ, wOceanFoam.x, wOceanFoam.y, wOceanPixel);")).toBeLessThan(layer);
    expect(at(l, "float wOceanCap = oceanCapCells(vOceanXZ, wOceanPixel);")).toBeLessThan(layer);
    expect(at(l, "wOceanCap *= 1.0 - wOceanFoam.y;")).toBeLessThan(layer);
    expect(l).toContain("float wFoamWhite = wOceanLace >= wOceanCap ? oceanFoamWhite(wFoamAge) : OCEAN_FOAM_ALBEDO;");
    // Then the matte layer: albedo toward the foam's white, transmission held, alpha toward 1, normal toward up.
    for (const line of [
      "surfaceAlbedo = mix(surfaceAlbedo, vec3(wFoamWhite), wFoam);",
      "wTransmit *= 1.0 - wFoam;",
      "alpha = mix(alpha, 1.0, wFoam);",
      "normalW = normalize(mix(normalW, vec3(0.0, 1.0, 0.0), wFoam));",
    ]) expect(at(l, line)).toBeGreaterThan(layer);
    const c = fx("waterCompose.fragment.fx");
    const foam = at(c, "finalRadianceScaled *= 1.0 - wFoam;");
    expect(c).toContain("finalSpecularScaled *= 1.0 - wFoam;");
    expect(foam).toBeGreaterThan(at(c, "#ifdef OCEAN"));
    expect(foam).toBeLessThan(at(c, "finalEmissive += wTransmit;"));
  });
});
