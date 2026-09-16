import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import vertexDefs from "../../src/game/shaders/foliage.vertex.fx?raw";
import vertexWorldPos from "../../src/game/shaders/foliageWorldPos.vertex.fx?raw";
import fragmentLights from "../../src/game/shaders/foliageLights.fragment.fx?raw";
import {
  attachFoliage, setFoliageWind, setFoliageEdges, FoliagePlugin, FOLIAGE_PROFILES,
  FOLIAGE_TILT, FOLIAGE_BEND, FOLIAGE_BEND_R, FOLIAGE_SINK, FOLIAGE_CLUMP_LUMA, FOLIAGE_CLUMP_CELL,
} from "../../src/game/foliagePlugin.js";
import {
  WIND_OMEGA_GUST, WIND_OMEGA_GUST2, WIND_OMEGA_FLUTTER, WIND_K1, WIND_K2, WIND_RAGGED, WIND_RAGGED_CELL,
  windRecordUnder,
} from "../../src/game/windParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

function glslFloat(n: number): string { return Number.isInteger(n) ? `${n}.0` : `${n}`; }

describe("foliage plugin", () => {
  it("attaches once, idempotently, and activates", () => {
    const mat = new PBRMaterial("m", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 0.4);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 0.4);
    const plugin = mat.pluginManager?.getPlugin("Foliage");
    expect(plugin).toBeInstanceOf(FoliagePlugin);
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active).toContain(plugin);
  });

  it("injects at the world-position and before-lights hooks only", () => {
    const mat = new PBRMaterial("m2", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 0.4);
    const plugin = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    const v = plugin.getCustomCode("vertex")!;
    expect(Object.keys(v).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_WORLDPOS"]);
    const f = plugin.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual(["CUSTOM_FRAGMENT_BEFORE_LIGHTS", "CUSTOM_FRAGMENT_DEFINITIONS"]);
    expect(v.CUSTOM_VERTEX_UPDATE_POSITION).toBeUndefined();
  });

  it("sets FOLIAGE always and FOLIAGE_TINT only for a tinting profile", () => {
    const grass = new PBRMaterial("g", scene);
    attachFoliage(grass, FOLIAGE_PROFILES.GRASS, 0.4);
    const tree = new PBRMaterial("t", scene);
    attachFoliage(tree, FOLIAGE_PROFILES.TREE, 30);
    const dg: Record<string, boolean> = { FOLIAGE: false, FOLIAGE_TINT: false };
    (grass.pluginManager!.getPlugin("Foliage") as FoliagePlugin).prepareDefines(dg as never, scene, undefined as never);
    expect(dg).toEqual({ FOLIAGE: true, FOLIAGE_TINT: true });
    const dt: Record<string, boolean> = { FOLIAGE: false, FOLIAGE_TINT: false };
    (tree.pluginManager!.getPlugin("Foliage") as FoliagePlugin).prepareDefines(dt as never, scene, undefined as never);
    expect(dt).toEqual({ FOLIAGE: true, FOLIAGE_TINT: false });
    // The attribute is pushed only for tinting profiles.
    const ag: string[] = [];
    (grass.pluginManager!.getPlugin("Foliage") as FoliagePlugin).getAttributes(ag, scene, undefined as never);
    expect(ag).toEqual(["foliage"]);
    const at: string[] = [];
    (tree.pluginManager!.getPlugin("Foliage") as FoliagePlugin).getAttributes(at, scene, undefined as never);
    expect(at).toEqual([]);
  });

  it("declares the record uniforms, the five-player array and the per-material profile", () => {
    const mat = new PBRMaterial("m3", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.BUSH, 1.2);
    const plugin = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    const u = plugin.getUniforms();
    const names = u.ubo!.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining([
      "windDir", "windLean", "windGust", "windFlutter", "windTime", "windPlayers", "windEye",
      "foliageAmp", "foliageHeight", "foliageTint", "foliageRootAO", "foliageNormalRoot", "foliageFlags", "foliageEdges",
    ]));
    const players = u.ubo!.find((x: { name: string }) => x.name === "windPlayers") as { arraySize?: number };
    expect(players.arraySize).toBe(5);
    expect(u.vertex).toContain("uniform vec3 windPlayers[5];");
  });

  it("the GLSL constants stay in lockstep with windParams.ts and this module", () => {
    expect(vertexDefs).toContain(`const float WIND_K1 = ${glslFloat(WIND_K1)};`);
    expect(vertexDefs).toContain(`const float WIND_K2 = ${glslFloat(WIND_K2)};`);
    expect(vertexDefs).toContain(`const float WIND_OMEGA1 = ${glslFloat(WIND_OMEGA_GUST)};`);
    expect(vertexDefs).toContain(`const float WIND_OMEGA2 = ${glslFloat(WIND_OMEGA_GUST2)};`);
    expect(vertexDefs).toContain(`const float WIND_OMEGA3 = ${glslFloat(WIND_OMEGA_FLUTTER)};`);
    expect(vertexDefs).toContain(`const float WIND_RAGGED = ${glslFloat(WIND_RAGGED)};`);
    expect(vertexDefs).toContain(`const float WIND_RAGGED_CELL = ${glslFloat(WIND_RAGGED_CELL)};`);
    expect(vertexDefs).toContain(`const float FOLIAGE_CLUMP_CELL = ${glslFloat(FOLIAGE_CLUMP_CELL)};`);
    expect(vertexWorldPos).toContain(`const float FOLIAGE_TILT = ${glslFloat(FOLIAGE_TILT)};`);
    expect(vertexWorldPos).toContain(`const float FOLIAGE_BEND = ${glslFloat(FOLIAGE_BEND)};`);
    expect(vertexWorldPos).toContain(`const float FOLIAGE_BEND_R = ${glslFloat(FOLIAGE_BEND_R)};`);
    expect(vertexWorldPos).toContain(`const float FOLIAGE_SINK = ${glslFloat(FOLIAGE_SINK)};`);
    expect(fragmentLights).toContain(`const float FOLIAGE_CLUMP_LUMA = ${glslFloat(FOLIAGE_CLUMP_LUMA)};`);
    // The gust closed form, token by token, so it cannot drift from gustAt.
    expect(vertexDefs).toContain("fract(c.x * 0.618034 + c.y * 0.381966) - 0.5");
    expect(vertexDefs).toContain("sin(WIND_K1 * u - WIND_OMEGA1 * t + ragged) + 0.5 * sin(WIND_K2 * u - WIND_OMEGA2 * t + 1.7 * ragged)");
    // Tips move, bases anchored.
    expect(vertexWorldPos).toContain("fH * fH");
    expect(fragmentLights).not.toContain("discard");
    expect(vertexDefs).not.toContain("sampler");
  });

  it("declares the foliage attribute only inside the FOLIAGE_TINT and THIN_INSTANCES gates", () => {
    const defs = vertexDefs;
    const attr = defs.indexOf("attribute vec4 foliage;");
    expect(attr).toBeGreaterThan(0);
    expect((defs.match(/attribute vec4 foliage;/g) ?? []).length).toBe(1);
    const before = defs.slice(0, attr);
    // "#ifdef FOLIAGE" is a literal prefix of "#ifdef FOLIAGE_TINT"; the
    // trailing newline picks out the standalone outer gate, not that prefix.
    expect(before.lastIndexOf("#ifdef THIN_INSTANCES")).toBeGreaterThan(before.lastIndexOf("#ifdef FOLIAGE_TINT"));
    expect(before.lastIndexOf("#ifdef FOLIAGE_TINT")).toBeGreaterThan(before.lastIndexOf("#ifdef FOLIAGE\n"));
    // No endif closes either gate between the gate and the attribute.
    expect(before.slice(before.lastIndexOf("#ifdef FOLIAGE_TINT"))).not.toContain("#endif");
  });

  it("binds the record and the players it was handed", () => {
    const mat = new PBRMaterial("m4", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 0.4);
    setFoliageEdges(mat, [88, 110]);
    const record = windRecordUnder(WEATHER_PRESETS.rain, 12);
    const players = new Float32Array(15).fill(0);
    players[0] = 3; players[2] = 4;
    setFoliageWind(record, players);
    const plugin = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    const writes: Record<string, unknown> = {};
    const ubo = {
      updateFloat: (n: string, v: number) => { writes[n] = v; },
      updateFloat2: (n: string, a: number, b: number) => { writes[n] = [a, b]; },
      updateFloat3: (n: string, a: number, b: number, c: number) => { writes[n] = [a, b, c]; },
      updateFloatArray: (n: string, v: Float32Array) => { writes[n] = Array.from(v); },
    };
    plugin.bindForSubMesh(ubo as never, scene, engine, undefined as never);
    expect(writes.windLean).toBeCloseTo(record.lean, 10);
    expect(writes.windTime).toBeCloseTo(record.time, 10);
    expect(writes.windDir).toEqual([record.dirX, record.dirZ]);
    expect(writes.foliageEdges).toEqual([88, 110]);
    expect((writes.windPlayers as number[]).slice(0, 3)).toEqual([3, 0, 4]);
    expect(writes.foliageHeight).toBe(0.4);
  });
});

describe("compiles on both shader paths (the sampler/UBO trap, pinned even with no sampler)", () => {
  async function compiledSources(targetScene: Scene, profileKey: "GRASS" | "TREE"): Promise<{ vertex: string; fragment: string }> {
    const material = new PBRMaterial(`pbr-${profileKey}`, targetScene);
    attachFoliage(material, FOLIAGE_PROFILES[profileKey], 1);
    const mesh = CreateBox(`box-${profileKey}`, {}, targetScene);
    mesh.material = material;
    const subMesh = mesh.subMeshes[0]!;
    await new Promise<void>((resolve) => {
      const tick = () => { if (material.isReadyForSubMesh(mesh, subMesh, false)) resolve(); else setTimeout(tick, 16); };
      tick();
    });
    return { vertex: subMesh.effect?.vertexSourceCode ?? "", fragment: subMesh.effect?.fragmentSourceCode ?? "" };
  }
  for (const version of [1, 2]) {
    it(`webGL ${version}: the record uniforms reach both stages; the attribute only under FOLIAGE_TINT`, async () => {
      const e = new NullEngine();
      (e as unknown as { _webGLVersion: number })._webGLVersion = version;
      const s = new Scene(e);
      try {
        const grass = await compiledSources(s, "GRASS");
        for (const name of ["windDir", "windLean", "windGust", "windTime", "windPlayers", "foliageEdges"]) expect(grass.vertex).toContain(name);
        for (const name of ["foliageTint", "foliageRootAO", "foliageNormalRoot", "vFoliageH"]) expect(grass.fragment).toContain(name);
        const tree = await compiledSources(s, "TREE");
        for (const name of ["windDir", "windLean", "windGust", "windTime", "windPlayers", "foliageEdges"]) expect(tree.vertex).toContain(name);
        for (const name of ["foliageTint", "foliageRootAO", "foliageNormalRoot", "vFoliageH"]) expect(tree.fragment).toContain(name);
      } finally {
        s.dispose();
        e.dispose();
      }
    });
  }
});
