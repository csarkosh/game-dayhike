// client/test/game/wetPlugin.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import {
  WetPlugin, attachWet, setWetCove, setWetLine, setWetSwash, setWetWeather, wetAlbedoFactor, wetBelowLine, wetCapOf,
  wetLineFor, wetLookAt, wetResidual, wetRoughnessOf, type WetLook,
  WET_ALBEDO, WET_CAP, WET_ROUGHNESS, WET_BAND, WET_LINE_ABOVE, WET_ROUGHNESS_ANCHOR, WET_ROUGHNESS_CODE, WET_RADIUS_MAX,
  WET_COVE_END, WET_DAMP_ALBEDO, WET_DAMP_ROUGHNESS, WET_DRY_S, WET_NO_COVE, WET_SOAKED_S, WET_SPECKLE, WET_SPECKLE_CELL,
  WET_SPECKLE_COVER, WET_SPECKLE_FAR, WET_SPECKLE_NEAR, WET_SPECKLE_S, WET_SWASH_VECS,
} from "../../src/game/wetPlugin.js";
import { SWASH_COLUMNS, SWASH_DRY_S, SWASH_SPECKLE_S, SWASH_STRIDE } from "../../src/game/swashTable.js";
import { COVE_END_BLEND } from "../../src/sim/olympic.js";
import { WATER_ROWS } from "../../src/game/waterShading.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => engine.dispose());

describe("wet plugin", () => {
  it("attaches once, idempotently (LOD buckets share materials)", () => {
    const mat = new PBRMaterial("g", scene);
    expect(attachWet(mat)).toBe(attachWet(mat));
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active.filter((p) => p instanceof WetPlugin)).toHaveLength(1);
  });

  it("injects the .fx files verbatim at definitions, before-lights, inside the reflectivity block and the roughness line", () => {
    const mat = new PBRMaterial("g2", scene);
    const p = attachWet(mat)!;
    const f = p.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual([
      "!float roughness=reflectivityOut\\.roughness;", "CUSTOM_FRAGMENT_BEFORE_LIGHTS", "CUSTOM_FRAGMENT_DEFINITIONS", "CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS",
    ]);
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("wet.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fx("wetLights.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS).toBe(fx("wetWeather.fragment.fx"));
    // the still line's gloss, under it the swash's damp ground held to WET_DAMP_ROUGHNESS at most
    expect(f["!float roughness=reflectivityOut\\.roughness;"]).toBe(
      "float roughness=mix(mix(reflectivityOut.roughness, min(reflectivityOut.roughness, WET_DAMP_ROUGHNESS), wetDamp), WET_ROUGHNESS, wetW);",
    );
    expect(f["!float roughness=reflectivityOut\\.roughness;"]).toBe(WET_ROUGHNESS_CODE);
    expect(p.getCustomCode("vertex")).toBeNull();
  });

  it("keeps its constants in lockstep with the GLSL", () => {
    const d = fx("wet.fragment.fx");
    expect(WET_ALBEDO).toBe(0.4);
    expect(WET_ROUGHNESS).toBe(0.15);
    expect(WET_BAND).toBe(0.1);
    expect(WET_LINE_ABOVE).toBe(0.3);
    expect(d).toContain(`const float WET_ALBEDO = ${glslFloat(WET_ALBEDO)};`);
    expect(d).toContain(`const float WET_ROUGHNESS = ${glslFloat(WET_ROUGHNESS)};`);
    expect(d).toContain(`const float WET_BAND = ${glslFloat(WET_BAND)};`);
    // the wet look below the line and inside the footprint, 1..3 m past the rim
    expect(d).toContain("return 1.0 - smoothstep(line - WET_BAND * 0.5, line + WET_BAND * 0.5, y);");
    expect(d).toContain("return 1.0 - smoothstep(radius + 1.0, radius + 3.0, length(xz - centre));");
    expect(fx("wetLights.fragment.fx")).toContain("float wetIn = wetInside(vPositionW.xz, wetCentre, wetRadius);");
    expect(fx("wetLights.fragment.fx")).toContain("float wetW = wetBelow(vPositionW.y, wetLine) * wetIn;");
    expect(fx("wetLights.fragment.fx")).toContain("surfaceAlbedo *= mix(1.0, WET_ALBEDO, wetW) * mix(1.0, WET_DAMP_ALBEDO, wetDamp);");
    // the darkening below the level, per channel, held to the footprint, gated on wetAttenuate
    expect(fx("wetLights.fragment.fx")).toContain("vec3 wetResidual = min(vec3(1.0), exp(-2.0 * (wetKd - vec3(wetKdMean)) * max(0.0, wetLevel - vPositionW.y) * wetIn));");
    expect(fx("wetLights.fragment.fx")).toContain("surfaceAlbedo *= mix(vec3(1.0), wetResidual, wetAttenuate);");
  });

  it("the regex anchor matches Babylon's real PBR fragment source", async () => {
    const src = (await import("@babylonjs/core/Shaders/pbr.fragment.js")).pbrPixelShader.shader as string;
    expect(src.match(new RegExp(WET_ROUGHNESS_ANCHOR.slice(1), "g"))).toHaveLength(1);
  });

  it("wetLineFor picks the nearest body's level plus the still band, and its kd", () => {
    const bodies = [
      { level: 0, kd: WATER_ROWS.sea.kd, lInf: WATER_ROWS.sea.lInf, shelter: 1, x: 0, z: 0, radius: Number.POSITIVE_INFINITY },
      { level: 42, kd: WATER_ROWS.lowlandLake.kd, lInf: WATER_ROWS.lowlandLake.lInf, shelter: 0.1, x: 100, z: 50, radius: 30 },
    ];
    expect(wetLineFor(bodies, 100, 50)).toEqual({ line: 42 + WET_LINE_ABOVE, level: 42, kd: WATER_ROWS.lowlandLake.kd, centre: [100, 50], radius: 30 });
    expect(wetLineFor(bodies, 500, 500)).toEqual({ line: 0 + WET_LINE_ABOVE, level: 0, kd: WATER_ROWS.sea.kd, centre: [0, 0], radius: WET_RADIUS_MAX });
    expect(wetLineFor([bodies[0]!], 5, 5).radius).toBe(WET_RADIUS_MAX);
    expect(wetLineFor(bodies, 160, 50).level).toBe(42); // 30 m from the rim
    expect(wetLineFor(bodies, 180, 50).level).toBe(0); // 50 m from the rim
  });

  it("setWetLine reaches every attached plugin", () => {
    const a = attachWet(new PBRMaterial("g3", scene))!;
    const b = attachWet(new PBRMaterial("g4", scene))!;
    setWetLine({ line: 12.3, level: 12, kd: [1, 2, 3], centre: [4, 5], radius: 6 }, false);
    expect(a.line).toBe(12.3);
    expect(b.kd).toEqual([1, 2, 3]);
    expect(b.attenuate).toBe(false);
  });

  it("a disposed material's plugin no longer takes the wet line", () => {
    const keptMat = new PBRMaterial("g5", scene);
    const goneMat = new PBRMaterial("g6", scene);
    const kept = attachWet(keptMat)!;
    const gone = attachWet(goneMat)!;
    setWetLine({ line: 1.3, level: 1, kd: [1, 1, 1], centre: [0, 0], radius: 10 }, true);
    goneMat.dispose();
    setWetLine({ line: 7.3, level: 7, kd: [2, 2, 2], centre: [3, 3], radius: 20 }, false);
    expect(kept.line).toBe(7.3);
    expect(gone.line).toBe(1.3);
    expect(gone.kd).toEqual([1, 1, 1]);
    expect(gone.attenuate).toBe(true);
    keptMat.dispose();
  });

  it("attaches to PBR materials only: any other material is left without the plugin", () => {
    const mat = new StandardMaterial("s", scene);
    expect(attachWet(mat)).toBeNull();
    expect(mat.pluginManager?.getPlugin("Wet") ?? null).toBeNull();
    setWetLine({ line: 2.3, level: 2, kd: [1, 2, 3], centre: [0, 0], radius: 5 }, true);
    expect(mat.pluginManager?.getPlugin("Wet") ?? null).toBeNull();
  });
});

describe("wet residual (the medium and low tiers' darkening, wetLights.fragment.fx)", () => {
  const kd = WATER_ROWS.lowlandLake.kd;
  const mean = (kd[0] + kd[1] + kd[2]) / 3;
  const perChannel = (depth: number): number[] => kd.map((k) => Math.min(1, Math.exp(-2 * (k - mean) * depth)));

  it("is the per-channel formula at the body's centre", () => {
    const r = wetResidual(kd, 10, 6, [100, 50], 30, [100, 50]);
    const want = perChannel(4);
    for (let i = 0; i < 3; i++) expect(r[i]).toBeCloseTo(want[i]!, 12);
    // the mechanism fired: some channel is darkened
    expect(Math.min(...r)).toBeLessThan(0.99);
  });

  it("is 1 in every channel 5 m outside the footprint, even 4 m below the level", () => {
    expect(wetResidual(kd, 10, 6, [100, 50], 30, [135, 50])).toEqual([1, 1, 1]);
  });

  it("blends over the 1..3 m edge past the rim", () => {
    const at = (d: number): number => Math.min(...wetResidual(kd, 10, 6, [0, 0], 30, [30 + d, 0]));
    expect(at(1)).toBeCloseTo(Math.min(...perChannel(4)), 12);
    expect(at(2)).toBeGreaterThan(at(1));
    expect(at(2)).toBeLessThan(1);
    expect(at(3)).toBe(1);
  });

  it("caps the sea's infinite radius as the uniform is, and darkens anywhere below its level", () => {
    const sea = WATER_ROWS.sea.kd;
    const r = wetResidual(sea, 0, -2, [0, 0], Number.POSITIVE_INFINITY, [5000, -3000]);
    expect(r.every((c) => Number.isFinite(c))).toBe(true);
    expect(Math.min(...r)).toBeLessThan(1);
  });
});

describe("the weather's wetting (wetWeather.fragment.fx)", () => {
  const names = ["wetLine", "wetLevel", "wetCentre", "wetRadius", "wetKd", "wetAttenuate", "wetWeather", "wetCap", "wetCove", "wetSwash"];

  it("caps the porosity per kind of material", () => {
    expect(WET_CAP).toEqual({ bark: 1, deadwood: 1, duff: 1, fungus: 1, prop: 1, rock: 0.5, cliff: 0.5, leaf: 0.3 });
  });

  it("declares wetWeather and wetCap on both uniform lists, after the wet line's", () => {
    const p = attachWet(new PBRMaterial("w1", scene))!;
    const uniforms = p.getUniforms();
    expect(uniforms.ubo.map((u) => u.name)).toEqual(names);
    expect([...uniforms.fragment.matchAll(/uniform\s+\w+\s+(\w+)(?:\[\d+\])?;/g)].map((m) => m[1])).toEqual(names);
    expect(uniforms.ubo.filter((u) => u.name === "wetWeather" || u.name === "wetCap").map((u) => u.type)).toEqual(["float", "float"]);
  });

  it("attachWet takes a cap, clamped, keeps it on a call without one, and reports it through wetCapOf", () => {
    const mat = new PBRMaterial("w2", scene);
    expect(attachWet(mat)!.cap).toBe(0);
    expect(wetCapOf(mat)).toBe(0);
    expect(attachWet(mat, 0.5)!.cap).toBe(0.5);
    expect(attachWet(mat)!.cap).toBe(0.5);
    expect(wetCapOf(mat)).toBe(0.5);
    expect(attachWet(mat, 1)!.cap).toBe(1);
    expect(attachWet(mat, 7)!.cap).toBe(1);
    expect(attachWet(mat, -1)!.cap).toBe(0);
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active.filter((p) => p instanceof WetPlugin)).toHaveLength(1);
    expect(wetCapOf(new PBRMaterial("w3", scene))).toBe(0);
    expect(wetCapOf(new StandardMaterial("w4", scene))).toBe(0);
    expect(attachWet(new StandardMaterial("w5", scene), 1)).toBeNull();
  });

  it("binds the page's wetness from setWetWeather, clamped, and the plugin's own cap", () => {
    const a = attachWet(new PBRMaterial("w6", scene), 0.3)!;
    const b = attachWet(new PBRMaterial("w7", scene))!;
    const writes: Record<string, number[]> = {};
    const ubo = {
      updateFloat: (n: string, x: number) => { writes[n] = [x]; },
      updateFloat2: (n: string, x: number, y: number) => { writes[n] = [x, y]; },
      updateFloat3: (n: string, x: number, y: number, z: number) => { writes[n] = [x, y, z]; },
      updateFloat4: (n: string, x: number, y: number, z: number, w: number) => { writes[n] = [x, y, z, w]; },
      updateFloatArray: (n: string, a: Float32Array) => { writes[n] = Array.from(a); },
    } as unknown as UniformBuffer;
    setWetWeather(0.75);
    a.bindForSubMesh(ubo);
    expect(Object.keys(writes).sort()).toEqual([...names].sort());
    expect(writes.wetWeather).toEqual([0.75]);
    expect(writes.wetCap).toEqual([0.3]);
    b.bindForSubMesh(ubo);
    expect(writes.wetWeather).toEqual([0.75]);
    expect(writes.wetCap).toEqual([0]);
    setWetWeather(3);
    a.bindForSubMesh(ubo);
    expect(writes.wetWeather).toEqual([1]);
    setWetWeather(-2);
    a.bindForSubMesh(ubo);
    expect(writes.wetWeather).toEqual([0]);
    setWetWeather(0);
  });

  it("is Lagarde's rule on the block's final roughness, held to the cap", () => {
    const d = fx("wetWeather.fragment.fx");
    expect(d).toContain("float wetPorosity = min(wetCap, clamp((metallicRoughness.g - 0.5) / 0.4, 0.0, 1.0));");
    expect(d).toContain("float wetFactor = mix(1.0, 0.2, wetPorosity);");
    expect(d).toContain("surfaceAlbedo *= mix(1.0, wetFactor, wetWeather);");
    expect(d).toContain("float wetGloss = mix(1.0, 1.0 - metallicRoughness.g, mix(1.0, wetFactor, 0.5 * wetWeather));");
    expect(d).toContain("metallicRoughness.g = 1.0 - wetGloss;");
    for (const line of d.split("\n")) {
      const comment = line.indexOf("//");
      if (comment === -1) continue;
      expect(line.slice(comment)).not.toMatch(/#\s*(if|ifdef|ifndef|else|elif|endif|define)/);
      if (!line.trim().startsWith("//")) expect(line.slice(comment)).not.toContain(";");
    }
  });

  it("lands inside the reflectivity block of a compiled PBR fragment, before the block reads the roughness", async () => {
    const e = new NullEngine();
    const s = new Scene(e);
    try {
      const mat = new PBRMaterial("w8", s);
      mat.metallic = 0;
      mat.roughness = 0.9;
      attachWet(mat, 1);
      const mesh = CreateBox("w8box", {}, s);
      mesh.material = mat;
      const subMesh = mesh.subMeshes[0]!;
      await new Promise<void>((resolve) => {
        const tick = () => {
          if (mat.isReadyForSubMesh(mesh, subMesh, false)) { resolve(); return; }
          setTimeout(tick, 16);
        };
        tick();
      });
      const source = subMesh.effect!.fragmentSourceCode;
      const at = source.indexOf("float wetPorosity = min(wetCap");
      expect(at).toBeGreaterThan(source.indexOf("reflectivityOutParams reflectivityBlock("));
      expect(at).toBeLessThan(source.indexOf("microSurface=1.0-metallicRoughness.g;vec3 baseColor=surfaceAlbedo;"));
      expect(source.match(/float wetPorosity/g)).toHaveLength(1);
      expect(source).toContain(WET_ROUGHNESS_CODE);
      // without uniform buffers (NullEngine is WebGL1) the cove and the table are plain uniforms, the table an array
      expect(source).toContain("uniform vec4 wetCove;");
      expect(source).toContain("uniform vec4 wetSwash[256];");
      // the swash's look after the still line's weight, before the albedo takes them
      expect(source.indexOf("vec3 wetCoveW = wetShore(vPositionW.xz, vPositionW.y) * wetIn;")).toBeGreaterThan(
        source.indexOf("float wetW = wetBelow(vPositionW.y, wetLine) * wetIn;"),
      );
    } finally {
      s.dispose();
      e.dispose();
    }
  });
});

describe("the swash's wet ground (wet.fragment.fx, wetLights.fragment.fx)", () => {
  /** What one bind writes for the swash: the cove's vec4 and the table's array, the array itself. */
  const swashBound = (p: WetPlugin): { cove: [number, number, number, number]; swash: Float32Array } => {
    let cove: [number, number, number, number] = [0, 0, 0, 0];
    let swash: Float32Array = new Float32Array(0);
    const ignore = (): void => undefined;
    const ubo = {
      updateFloat: ignore, updateFloat2: ignore, updateFloat3: ignore,
      updateFloat4: (n: string, x: number, y: number, z: number, w: number) => { if (n === "wetCove") cove = [x, y, z, w]; },
      updateFloatArray: (n: string, a: Float32Array) => { if (n === "wetSwash") swash = a; },
    } as unknown as UniformBuffer;
    p.bindForSubMesh(ubo);
    return { cove, swash };
  };
  /** The swash's table with every column at one reach and age, as `SwashTable.data` holds them. */
  const tableOf = (reach: number, age: number): Float32Array => {
    const data = new Float32Array(SWASH_COLUMNS * SWASH_STRIDE);
    for (let c = 0; c < SWASH_COLUMNS; c++) {
      data[c * SWASH_STRIDE] = reach;
      data[c * SWASH_STRIDE + 1] = 0.25;
      data[c * SWASH_STRIDE + 2] = reach;
      data[c * SWASH_STRIDE + 3] = age;
    }
    return data;
  };
  const look = (): WetLook => ({ wet: 0, damp: 0, speckle: 0 });
  // The module's cove and table are the page's: put them back as they start.
  afterEach(() => {
    setWetCove(Number.NaN, 0, 0, 0);
    setWetSwash(tableOf(0, WET_DRY_S));
  });

  it("declares the cove and the table, 256 vec4s, after the weather's, on both paths", () => {
    const u = attachWet(new PBRMaterial("ws1", scene))!.getUniforms();
    expect(u.ubo.slice(-2)).toEqual([
      { name: "wetCove", size: 4, type: "vec4" },
      { name: "wetSwash", size: 4, type: "vec4", arraySize: 256 },
    ]);
    expect(u.fragment).toContain("uniform float wetCap;\nuniform vec4 wetCove;\nuniform vec4 wetSwash[256];");
    // no sampler: the terrain's fragment stage binds all 16 a stage may
    expect(u.fragment).not.toContain("sampler");
  });

  it("keeps its constants in lockstep with the GLSL, the swash's table and the cove's ground", () => {
    const d = fx("wet.fragment.fx");
    const constants: [string, number][] = [
      ["WET_DAMP_ALBEDO", WET_DAMP_ALBEDO], ["WET_DAMP_ROUGHNESS", WET_DAMP_ROUGHNESS], ["WET_DRY_S", WET_DRY_S],
      ["WET_SOAKED_S", WET_SOAKED_S], ["WET_SPECKLE", WET_SPECKLE], ["WET_SPECKLE_S", WET_SPECKLE_S],
      ["WET_SPECKLE_CELL", WET_SPECKLE_CELL], ["WET_SPECKLE_COVER", WET_SPECKLE_COVER], ["WET_SPECKLE_NEAR", WET_SPECKLE_NEAR],
      ["WET_SPECKLE_FAR", WET_SPECKLE_FAR], ["WET_COVE_END", WET_COVE_END], ["WET_SWASH_COLUMNS", SWASH_COLUMNS],
      ["WET_SWASH_HALF", SWASH_COLUMNS / 2],
    ];
    for (const [name, value] of constants) expect(d, name).toContain(`const float ${name} = ${glslFloat(value)};`);
    expect([WET_DAMP_ALBEDO, WET_DAMP_ROUGHNESS, WET_DRY_S, WET_SOAKED_S]).toEqual([0.7, 0.5, 60, 0.5]);
    expect([WET_SPECKLE, WET_SPECKLE_S, WET_SPECKLE_CELL, WET_SPECKLE_COVER, WET_SPECKLE_NEAR, WET_SPECKLE_FAR]).toEqual([0.2, 10, 0.05, 0.25, 10, 25]);
    expect([WET_COVE_END, WET_SWASH_VECS, WET_NO_COVE]).toEqual([30, 256, -1e6]);
    // the same numbers as the table's and the ground's
    expect(SWASH_DRY_S).toBe(60);
    expect(WET_DRY_S - SWASH_DRY_S).toBe(0);
    expect(WET_SPECKLE_S - SWASH_SPECKLE_S).toBe(0);
    expect(WET_COVE_END - COVE_END_BLEND).toBe(0);
    expect(WET_SWASH_VECS * 2 - SWASH_COLUMNS).toBe(0);
  });

  it("holds the GLSL wetLookAt transcribes, whole, so no change to it passes unseen", () => {
    const d = fx("wet.fragment.fx");
    expect(d).toContain(
      "float wetCoveShare(float z) {\n" +
        "  return 1.0 - smoothstep(wetCove.y - WET_COVE_END, wetCove.y + WET_COVE_END, abs(z - wetCove.x));\n" +
        "}\n",
    );
    expect(d).toContain(
      "vec2 wetSwashAt(float z) {\n" +
        "  float c = floor(clamp(z - wetCove.x + WET_SWASH_HALF, 0.0, WET_SWASH_COLUMNS - 1.0) + 0.5);\n" +
        "  vec4 pair = wetSwash[int(c * 0.5)];\n" +
        "  return mix(pair.xy, pair.zw, mod(c, 2.0));\n" +
        "}\n",
    );
    expect(d).toContain(
      "vec3 wetShore(vec2 xz, float y) {\n" +
        "  vec2 col = wetSwashAt(xz.y);\n" +
        "  float band = wetBelow(y, wetLevel + col.x * wetCove.w) * wetCoveShare(xz.y);\n" +
        "  float soaked = 1.0 - smoothstep(WET_SOAKED_S, WET_DRY_S / 3.0, col.y);\n" +
        "  float damp = smoothstep(WET_SOAKED_S, WET_DRY_S / 3.0, col.y) - smoothstep(WET_DRY_S / 3.0, WET_DRY_S, col.y);\n" +
        "  float fresh = clamp(1.0 - col.y / WET_SPECKLE_S, 0.0, 1.0);\n" +
        "  float above = 1.0 - wetBelow(y, wetLevel);\n" +
        "  return vec3(soaked, damp, WET_SPECKLE * fresh * above) * band;\n" +
        "}\n",
    );
    expect(d).toContain(
      "float wetSpeckle(vec2 xz, float far) {\n" +
        "  vec3 p3 = fract(vec3(floor(xz / WET_SPECKLE_CELL).xyx) * 0.1031);\n" +
        "  p3 += dot(p3, p3.yzx + 33.33);\n" +
        "  float on = step(1.0 - WET_SPECKLE_COVER, fract((p3.x + p3.y) * p3.z));\n" +
        "  return mix(on, WET_SPECKLE_COVER, smoothstep(WET_SPECKLE_NEAR, WET_SPECKLE_FAR, far));\n" +
        "}\n",
    );
    expect(fx("wetLights.fragment.fx")).toContain(
      "float wetW = wetBelow(vPositionW.y, wetLine) * wetIn;\n" +
        "// Inside the cove the swash's table wets the face as well (wetShore): soaked\n" +
        "// up to the still line or the column's reach, whichever is higher, then damp\n" +
        "// and speckled. Outside it the three are 0 and the still line's look is as\n" +
        "// it was, to the bit.\n" +
        "vec3 wetCoveW = wetShore(vPositionW.xz, vPositionW.y) * wetIn;\n" +
        "wetW = max(wetW, wetCoveW.x);\n" +
        "float wetDamp = wetCoveW.y * (1.0 - wetW);\n" +
        "surfaceAlbedo *= mix(1.0, WET_ALBEDO, wetW) * mix(1.0, WET_DAMP_ALBEDO, wetDamp);\n" +
        "surfaceAlbedo = mix(surfaceAlbedo, vec3(1.0), wetCoveW.z * wetSpeckle(vPositionW.xz, length(vPositionW - vEyePosition.xyz)));\n",
    );
  });

  it("packs the table's reach and age, two columns a vec4, into one array every plugin binds, made once", () => {
    const a = attachWet(new PBRMaterial("ws2", scene))!;
    const b = attachWet(new PBRMaterial("ws3", scene))!;
    const before = swashBound(a).swash;
    expect(before.length).toBe(1024);
    const data = new Float32Array(SWASH_COLUMNS * SWASH_STRIDE);
    for (let c = 0; c < SWASH_COLUMNS; c++) {
      data[c * SWASH_STRIDE] = 100 + c;
      data[c * SWASH_STRIDE + 1] = 200 + c;
      data[c * SWASH_STRIDE + 2] = c * 0.5;
      data[c * SWASH_STRIDE + 3] = c * 2;
    }
    data[7 * SWASH_STRIDE + 2] = Number.NaN;
    data[7 * SWASH_STRIDE + 3] = Number.POSITIVE_INFINITY;
    data[9 * SWASH_STRIDE + 2] = -3;
    setWetSwash(data);
    const bound = swashBound(a).swash;
    // the one array, refilled in place, the same for every plugin
    expect(bound).toBe(before);
    expect(swashBound(b).swash).toBe(before);
    // (reach, age) of columns 0 and 1, then 2 and 3: the front and the thickness are not read
    expect(Array.from(bound.subarray(0, 8))).toEqual([0, 0, 0.5, 2, 1, 4, 1.5, 6]);
    expect(Array.from(bound.subarray(1020, 1024))).toEqual([255, 1020, 255.5, 1022]);
    // a reach that is not a finite number is none, an age dry, a reach below zero none
    expect(Array.from(bound.subarray(14, 16))).toEqual([0, 60]);
    expect(bound[18]).toBe(0);
    expect(bound.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("binds the cove for every plugin, and no cove when a number of it is not finite", () => {
    const p = attachWet(new PBRMaterial("ws4", scene))!;
    expect(swashBound(p).cove).toEqual([0, -1e6, 0, 0]);
    setWetCove(37.25, 155, -24, 0.25);
    expect(swashBound(p).cove).toEqual([37.25, 155, -24, 0.25]);
    expect(swashBound(attachWet(new PBRMaterial("ws5", scene))!).cove).toEqual([37.25, 155, -24, 0.25]);
    setWetCove(37.25, Number.NaN, -24, 0.25);
    expect(swashBound(p).cove).toEqual([0, -1e6, 0, 0]);
  });

  it("gives a material outside the cove the still line's weight, albedo and roughness to the bit, whatever the table holds", () => {
    const p = attachWet(new PBRMaterial("ws6", scene))!;
    // the old weight, wetBelow(y, wetLine) * wetIn, as the GLSL had it
    const smooth = (e0: number, e1: number, x: number): number => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const old = (y: number, line: number, inside: number): number => (1 - smooth(line - 0.05, line + 0.05, y)) * inside;
    let checked = 0;
    const out = look();
    for (const set of ["no cove", "a cove past its end"] as const) {
      if (set === "a cove past its end") {
        setWetCove(37.25, 155, -24, 1 / 12);
        // every column wet, fresh and high: none of it may reach past the end's blend
        setWetSwash(tableOf(12, 0));
      }
      const { cove, swash } = swashBound(p);
      const zs = set === "no cove" ? [-5000, -40, 0, 37.25, 900] : [37.25 - 185.5, 37.25 + 185, 37.25 + 640, -5000];
      for (const z of zs) {
        for (const y of [-2, -0.5, 0, 0.26, 0.3, 0.33, 0.4, 1, 7.5]) {
          for (const inside of [0, 0.4, 1]) {
            for (const r of [0.05, 0.6, 1]) {
              wetLookAt(y, z, 0.3, 0, inside, cove, swash, out);
              const w = old(y, 0.3, inside);
              expect(out.wet).toBe(w);
              expect(out.damp).toBe(0);
              expect(out.speckle).toBe(0);
              expect(wetAlbedoFactor(out)).toBe(1 * (1 - w) + WET_ALBEDO * w);
              expect(wetRoughnessOf(r, out)).toBe(r * (1 - w) + WET_ROUGHNESS * w);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(729);
    // wetBelowLine is the GLSL's wetBelow
    expect(wetBelowLine(0.3, 0.3)).toBe(0.5);
  });

  it("moves the line inside the cove by the column's reach times the face's grade, and keeps the still line under it", () => {
    const p = attachWet(new PBRMaterial("ws7", scene))!;
    setWetCove(37.25, 155, -24, 1 / 12);
    const out = look();
    const wetAt = (y: number): number => {
      const { cove, swash } = swashBound(p);
      return wetLookAt(y, 37.25, 0.3, 0, 1, cove, swash, out).wet;
    };
    // a reach of 6 m up the 1:12 face: the line half a metre above the still sea
    setWetSwash(tableOf(6, 0));
    expect(wetAt(0.44)).toBe(1);
    expect(wetAt(0.5)).toBeCloseTo(0.5, 12);
    expect(wetAt(0.56)).toBe(0);
    // 9 m: three quarters of a metre, 3 m more of reach a quarter of a metre more of line
    setWetSwash(tableOf(9, 0));
    expect(wetAt(0.56)).toBe(1);
    expect(wetAt(0.75)).toBeCloseTo(0.5, 12);
    expect(wetAt(0.81)).toBe(0);
    // a calm sea: no reach, never wetted; the still line alone
    setWetSwash(tableOf(0, 600));
    expect(wetAt(0.2)).toBe(1);
    expect(wetAt(0.3)).toBeCloseTo(0.5, 12);
    expect(wetAt(0.4)).toBe(0);
    expect(out.damp).toBe(0);
    expect(out.speckle).toBe(0);
  });

  it("soaks for half a second, damps by twenty, dries by sixty, and speckles above the sea for ten", () => {
    const p = attachWet(new PBRMaterial("ws8", scene))!;
    setWetCove(37.25, 155, -24, 1 / 12);
    const out = look();
    // 0.4 m up: above the still line, under a 6 m reach's 0.5 m line
    const at = (age: number): WetLook => {
      setWetSwash(tableOf(6, age));
      const { cove, swash } = swashBound(p);
      return wetLookAt(0.4, 37.25, 0.3, 0, 1, cove, swash, out);
    };
    expect(at(0)).toEqual({ wet: 1, damp: 0, speckle: 0.2 });
    expect(wetAlbedoFactor(out)).toBe(0.4);
    expect(wetRoughnessOf(0.9, out)).toBe(0.15);
    expect(at(0.5)).toEqual({ wet: 1, damp: 0, speckle: 0.19 });
    const five = at(5);
    expect(five.wet).toBeCloseTo(0.864816, 6);
    expect(five.damp).toBeCloseTo(0.018275, 6);
    expect(five.speckle).toBeCloseTo(0.1, 12);
    expect(wetAlbedoFactor(out)).toBeCloseTo(0.478473, 6);
    expect(at(10).speckle).toBe(0);
    expect(at(20)).toEqual({ wet: 0, damp: 1, speckle: 0 });
    expect(wetAlbedoFactor(out)).toBe(0.7);
    expect(wetRoughnessOf(0.9, out)).toBe(0.5);
    // damp ground never roughens a surface smoother than it
    expect(wetRoughnessOf(0.3, out)).toBe(0.3);
    expect(at(40)).toEqual({ wet: 0, damp: 0.5, speckle: 0 });
    expect(wetAlbedoFactor(out)).toBe(0.85);
    expect(at(60)).toEqual({ wet: 0, damp: 0, speckle: 0 });
    expect(wetAlbedoFactor(out)).toBe(1);
    expect(at(600)).toEqual({ wet: 0, damp: 0, speckle: 0 });
    // under the still sea the speckle is gone: the water covers it
    setWetSwash(tableOf(6, 0));
    const { cove, swash } = swashBound(p);
    expect(wetLookAt(-0.4, 37.25, 0.3, 0, 1, cove, swash, out).speckle).toBe(0);
  });

  it("fades into the bays over the cove's ends, as its ground does", () => {
    const p = attachWet(new PBRMaterial("ws9", scene))!;
    setWetCove(37.25, 155, -24, 1 / 12);
    setWetSwash(tableOf(6, 0));
    const { cove, swash } = swashBound(p);
    const out = look();
    const wetAt = (z: number): number => wetLookAt(0.4, z, 0.3, 0, 1, cove, swash, out).wet;
    expect(wetAt(37.25 + 125)).toBe(1);
    expect(wetAt(37.25 - 125)).toBe(1);
    expect(wetAt(37.25 + 155)).toBe(0.5);
    expect(wetAt(37.25 - 155)).toBe(0.5);
    expect(wetAt(37.25 + 185)).toBe(0);
    expect(wetAt(37.25 - 185)).toBe(0);
  });

  it("lays the table out in a uniform buffer as 256 vec4s from a vec4 boundary, written in place on every bind", () => {
    const own = webgpuProcessingEngine();
    try {
      const s = new Scene(own);
      const p = attachWet(new PBRMaterial("ws10", s))!;
      const ubo = new UniformBuffer(own, undefined, false, "wetTest");
      for (const u of p.getUniforms().ubo) ubo.addUniform(u.name, u.size, u.arraySize ?? 0);
      ubo.create();
      const view = ubo as unknown as { _bufferData: Float32Array; _uniformLocations: Record<string, number> };
      const at = view._uniformLocations.wetSwash as number;
      expect(at % 4).toBe(0);
      expect(view._bufferData.length - at).toBe(1024);
      setWetSwash(tableOf(6, 5));
      p.bindForSubMesh(ubo);
      expect(Array.from(view._bufferData.subarray(at, at + 8))).toEqual([6, 5, 6, 5, 6, 5, 6, 5]);
      expect(Array.from(view._bufferData.subarray(at + 1020, at + 1024))).toEqual([6, 5, 6, 5]);
      setWetCove(37.25, 155, -24, 0.25);
      p.bindForSubMesh(ubo);
      const cove = view._uniformLocations.wetCove as number;
      expect(Array.from(view._bufferData.subarray(cove, cove + 4))).toEqual([37.25, 155, -24, 0.25]);
      ubo.dispose();
    } finally {
      own.dispose();
    }
  });

  it("sets the table as the vec4s it is where uniform buffers are off", () => {
    // NullEngine is WebGL1: no uniform buffers, so every update goes to the effect, as on Chrome on macOS
    const own = new NullEngine();
    try {
      const s = new Scene(own);
      const p = attachWet(new PBRMaterial("ws11", s))!;
      const ubo = new UniformBuffer(own);
      for (const u of p.getUniforms().ubo) ubo.addUniform(u.name, u.size, u.arraySize ?? 0);
      const calls: [string, unknown][] = [];
      (ubo as unknown as { _currentEffect: unknown })._currentEffect = new Proxy(
        {},
        { get: (_t, key) => (name: string, value: unknown) => void calls.push([`${String(key)} ${name}`, value]) },
      );
      setWetSwash(tableOf(6, 5));
      p.bindForSubMesh(ubo);
      const table = calls.filter(([call]) => call.endsWith(" wetSwash"));
      expect(table.map(([call]) => call)).toEqual(["setFloatArray4 wetSwash"]);
      expect((table[0]![1] as Float32Array).length).toBe(1024);
      expect(calls.map(([call]) => call)).toContain("setFloat4 wetCove");
    } finally {
      own.dispose();
    }
  });
});

describe("a wet PBR material's stages, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => { translators = await startTranslators(); }, timeLimit(60_000));

  it("compile through glslang and translate to WGSL as Babylon's WebGPU processing hands them over", async () => {
    const gpu = webgpuProcessingEngine();
    const gpuScene = new Scene(gpu);
    try {
      const mat = new PBRMaterial("w9", gpuScene);
      mat.metallic = 0;
      mat.roughness = 0.9;
      attachWet(mat, WET_CAP.bark);
      const mesh = CreateBox("w9box", {}, gpuScene);
      mesh.material = mat;
      const effect = await drawnEffect(mesh);
      expect(effect._fragmentSourceCode).toContain("float wetPorosity = min(wetCap");
      // Each stage composed as the page composes it for the first translator
      // (`shaderLookup.ts`): a stage that does not parse throws here, with
      // glslang's line and message on stderr. The albedo is a function
      // parameter the rule writes, which the translation must carry.
      const defines = (effect as unknown as { defines: string }).defines;
      const stage = (kind: "vertex" | "fragment", code: string) =>
        translateStage(translators, { stage: kind, flag: uniformityOff(code), glsl: translatorInput(code, defines) });
      const vertex = stage("vertex", effect._vertexSourceCode);
      const fragment = stage("fragment", effect._fragmentSourceCode);
      expect(vertex.length).toBeGreaterThan(0);
      expect(fragment).toContain("wetCap");
      expect(fragment).toContain("wetWeather");
      // the table in the material's uniform buffer, 256 vec4s, read by the column's index
      expect(effect._fragmentSourceCode).toMatch(/\bvec4 wetSwash\[256\];/);
      expect(fragment).toContain("array<vec4<f32>, 256u>");
      expect(fragment).toMatch(/\bwetSwash : \w+,/);
      expect(fragment).toContain("wetShore");
    } finally {
      gpuScene.dispose();
      gpu.dispose();
    }
  }, timeLimit(60_000));
});
