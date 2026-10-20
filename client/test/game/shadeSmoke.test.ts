import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import {
  SHADE_SMOKE_FEET, SHADE_SMOKE_FOLD_S, SHADE_SMOKE_FRAY, SHADE_SMOKE_RISE, SHADE_SMOKE_SCALE, SHADE_SMOKE_SOFT, SHADE_SMOKE_SWELL_M,
  ShadeSmokePlugin, attachShadeSmoke,
} from "../../src/game/shadeSmoke.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
function glslFloat(n: number): string { return Number.isInteger(n) ? `${n}.0` : `${n}`; }

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => engine.dispose());

describe("the shades' smoke", () => {
  it("attaches once and activates", () => {
    const mat = new StandardMaterial("s", scene);
    const plugin = attachShadeSmoke(mat);
    expect(attachShadeSmoke(mat)).toBe(plugin);
    expect(plugin).toBeInstanceOf(ShadeSmokePlugin);
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active.filter((p) => p instanceof ShadeSmokePlugin)).toHaveLength(1);
  });

  it("asks for normals though the mask's material is unlit, and swells and dissolves from the GLSL the files hold", () => {
    const mat = new StandardMaterial("s2", scene);
    const plugin = attachShadeSmoke(mat);
    const defines = { _needNormals: false } as unknown as MaterialDefines;
    plugin.prepareDefinesBeforeAttributes(defines, scene, undefined as never);
    expect((defines as unknown as { _needNormals: boolean })._needNormals).toBe(true);
    const v = plugin.getCustomCode("vertex")!;
    expect(Object.keys(v).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_WORLDPOS"]);
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("shadeSmokeNoise.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toBe(fx("shadeSmokeWorldPos.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toContain("worldPos.xyz += vNormalW * shadeSmokeSwell * 2.0 * shadeSmokeEdge.y;");
    const f = plugin.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual(["CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR", "CUSTOM_FRAGMENT_DEFINITIONS"]);
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("shadeSmokeNoise.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toBe(fx("shadeSmokeColour.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toContain("color.a *= shadeSmokeKeep;");
    expect(plugin.getCustomCode("compute")).toBeNull();
  });

  it("keeps the noise's numbers in lockstep with the GLSL, and the fraying and the swell where the plugin sends them", () => {
    const noise = fx("shadeSmokeNoise.fx");
    expect(SHADE_SMOKE_SCALE).toBe(0.9);
    expect(SHADE_SMOKE_RISE).toBe(0.6);
    expect(SHADE_SMOKE_SOFT).toBe(0.12);
    expect(SHADE_SMOKE_FEET).toBe(0.16);
    for (const [name, value] of [["SHADE_SMOKE_SCALE", SHADE_SMOKE_SCALE], ["SHADE_SMOKE_RISE", SHADE_SMOKE_RISE], ["SHADE_SMOKE_SOFT", SHADE_SMOKE_SOFT], ["SHADE_SMOKE_FEET", SHADE_SMOKE_FEET]] as const) {
      expect(noise).toContain(`const float ${name} = ${glslFloat(value)};`);
    }
    expect(SHADE_SMOKE_FRAY).toBe(0.55);
    expect(SHADE_SMOKE_SWELL_M).toBe(0.35);
    expect(SHADE_SMOKE_FOLD_S).toBe(3600);
    const plugin = attachShadeSmoke(new StandardMaterial("s3", scene));
    const sent: Record<string, number[]> = {};
    const buffer = {
      updateFloat4: (name: string, a: number, b: number, c: number, d: number) => { sent[name] = [a, b, c, d]; },
      updateFloat2: (name: string, a: number, b: number) => { sent[name] = [a, b]; },
    };
    plugin.presence = 0.25;
    plugin.time = 12;
    plugin.feetY = 140;
    plugin.height = 5.4;
    plugin.bindForSubMesh(buffer as never, scene, engine, undefined as never);
    expect(sent.shadeSmoke).toEqual([0.25, 12, 140, 5.4]);
    expect(sent.shadeSmokeEdge).toEqual([0.55, 0.35]);
  });
});
