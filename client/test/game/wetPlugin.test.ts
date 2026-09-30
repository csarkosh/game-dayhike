// client/test/game/wetPlugin.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { WetPlugin, attachWet, setWetLine, wetLineFor, wetResidual, WET_ALBEDO, WET_ROUGHNESS, WET_BAND, WET_LINE_ABOVE, WET_ROUGHNESS_ANCHOR, WET_RADIUS_MAX } from "../../src/game/wetPlugin.js";
import { WATER_ROWS } from "../../src/game/waterShading.js";

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

  it("injects the .fx files verbatim at definitions, before-lights and the roughness line", () => {
    const mat = new PBRMaterial("g2", scene);
    const p = attachWet(mat)!;
    const f = p.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual(["!float roughness=reflectivityOut\\.roughness;", "CUSTOM_FRAGMENT_BEFORE_LIGHTS", "CUSTOM_FRAGMENT_DEFINITIONS"]);
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("wet.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fx("wetLights.fragment.fx"));
    expect(f["!float roughness=reflectivityOut\\.roughness;"]).toBe("float roughness=mix(reflectivityOut.roughness, WET_ROUGHNESS, wetW);");
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
