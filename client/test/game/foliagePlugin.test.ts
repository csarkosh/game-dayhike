import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import vertexDefs from "../../src/game/shaders/foliage.vertex.fx?raw";
import vertexWorldPos from "../../src/game/shaders/foliageWorldPos.vertex.fx?raw";
import fragmentLights from "../../src/game/shaders/foliageLights.fragment.fx?raw";
import {
  attachFoliage, setFoliageWind, setFoliageEdges, setFoliageBladeEdges, FoliagePlugin, FOLIAGE_PROFILES,
  FOLIAGE_PLAYERS,
  FOLIAGE_TILT, FOLIAGE_BEND, FOLIAGE_BEND_R, FOLIAGE_SINK, FOLIAGE_CLUMP_LUMA, FOLIAGE_CLUMP_CELL,
  FOLIAGE_PLAYER_PARKED, FOLIAGE_BLADE_SOFT,
} from "../../src/game/foliagePlugin.js";
import {
  WIND_OMEGA_GUST, WIND_OMEGA_GUST2, WIND_OMEGA_FLUTTER, WIND_K1, WIND_K2, WIND_RAGGED, WIND_RAGGED_CELL,
  windRecordUnder,
} from "../../src/game/windParams.js";
import { WEATHER_PRESETS } from "../../src/game/weather.js";
import { BLADE_SOFT, bladeAlive, bladeSecondRandom } from "../../src/game/bladeClump.js";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

function glslFloat(n: number): string { return Number.isInteger(n) ? `${n}.0` : `${n}`; }

describe("foliage plugin", () => {
  it("FOLIAGE_PROFILES matches the spec's table exactly", () => {
    expect(FOLIAGE_PROFILES).toEqual({
      GRASS: { amp: 1.0, groundTint: 0.6, rootAO: 0.45, normalRoot: 0, tilt: true, bend: true, blades: false, normalUp: 0 },
      MEADOW: { amp: 1.0, groundTint: 0.7, rootAO: 0.5, normalRoot: 0, tilt: true, bend: true, blades: false, normalUp: 0 },
      FLOWER: { amp: 0.83, groundTint: 0.4, rootAO: 0.5, normalRoot: 0, tilt: true, bend: true, blades: false, normalUp: 0 },
      BUSH: { amp: 0.5, groundTint: 0.3, rootAO: 0.6, normalRoot: 0, tilt: false, bend: true, blades: false, normalUp: 0 },
      UNDERSTORY: { amp: 0.67, groundTint: 0.4, rootAO: 0.55, normalRoot: 0, tilt: false, bend: true, blades: false, normalUp: 0 },
      TREE: { amp: 0.33, groundTint: 0, rootAO: 1, normalRoot: 0.6, tilt: false, bend: false, blades: false, normalUp: 0 },
      BLADES: { amp: 1.0, groundTint: 0.7, rootAO: 0.5, normalRoot: 0, tilt: true, bend: true, blades: true, normalUp: 1.0 },
      DUFF: { amp: 0, groundTint: 0.5, rootAO: 0.6, normalRoot: 0, tilt: false, bend: false, blades: true, normalUp: 0.5 },
    });
  });

  it("binds the DUFF profile's amp as a zero wind uniform, not merely a zero constant", () => {
    // amp governs the motion weight the vertex shader multiplies the whole
    // wind displacement by (foliageWorldPos.vertex.fx's `fM`); reading
    // FOLIAGE_PROFILES.DUFF.amp only proves the constant is 0, not that the
    // material the renderer actually draws with receives it. Bound here with
    // a gusty, leaning wind record in play, so a wrong wire-up (binding some
    // other profile's amp, or a stale one) would show up as a non-zero write.
    const mat = new PBRMaterial("m-duff-amp", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.DUFF, 0.1);
    const plugin = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    setFoliageWind({ dirX: 1, dirZ: 0, speed: 1, lean: 0.4, gustAmp: 0.9, flutterAmp: 0.7, time: 3 }, new Float32Array(FOLIAGE_PLAYERS * 3));
    const writes: Record<string, number[]> = {};
    const ub = {
      updateFloat: (n: string, v: number) => { writes[n] = [v]; },
      updateFloat2: (n: string, a: number, b: number) => { writes[n] = [a, b]; },
      updateFloat3: (n: string, a: number, b: number, c: number) => { writes[n] = [a, b, c]; },
      updateFloat4: (n: string, a: number, b: number, c: number, d: number) => { writes[n] = [a, b, c, d]; },
      updateFloatArray: (n: string, v: Float32Array) => { writes[n] = Array.from(v); },
    };
    plugin.bindForSubMesh(ub as never, scene, undefined as never, undefined as never);
    expect(writes.foliageAmp).toEqual([0]);
    // The wind itself is live (not accidentally zeroed too) — amp alone gates duff.
    expect(writes.windGust).toEqual([0.9]);
  });

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
    const dg: Record<string, boolean> = { FOLIAGE: false, FOLIAGE_TINT: false, FOLIAGE_BLADES: false };
    (grass.pluginManager!.getPlugin("Foliage") as FoliagePlugin).prepareDefines(dg as never, scene, undefined as never);
    expect(dg).toEqual({ FOLIAGE: true, FOLIAGE_TINT: true, FOLIAGE_BLADES: false });
    const dt: Record<string, boolean> = { FOLIAGE: false, FOLIAGE_TINT: false, FOLIAGE_BLADES: false };
    (tree.pluginManager!.getPlugin("Foliage") as FoliagePlugin).prepareDefines(dt as never, scene, undefined as never);
    expect(dt).toEqual({ FOLIAGE: true, FOLIAGE_TINT: false, FOLIAGE_BLADES: false });
    // The attribute is pushed only for tinting profiles.
    const ag: string[] = [];
    (grass.pluginManager!.getPlugin("Foliage") as FoliagePlugin).getAttributes(ag, scene, undefined as never);
    expect(ag).toEqual(["foliage"]);
    const at: string[] = [];
    (tree.pluginManager!.getPlugin("Foliage") as FoliagePlugin).getAttributes(at, scene, undefined as never);
    expect(at).toEqual([]);
  });

  it("sets FOLIAGE_BLADES and pushes the blade attribute for the BLADES profile only", () => {
    const blades = new PBRMaterial("b", scene);
    attachFoliage(blades, FOLIAGE_PROFILES.BLADES, 0.6);
    const plugin = blades.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    const d: Record<string, boolean> = { FOLIAGE: false, FOLIAGE_TINT: false, FOLIAGE_BLADES: false };
    plugin.prepareDefines(d as never, scene, undefined as never);
    expect(d).toEqual({ FOLIAGE: true, FOLIAGE_TINT: true, FOLIAGE_BLADES: true });
    const a: string[] = [];
    plugin.getAttributes(a, scene, undefined as never);
    expect(a).toEqual(["foliage", "blade", "bladeStrength"]);
  });

  it("declares the blade attributes only under FOLIAGE_BLADES, and collapses after the wind with a grow-in and a strength cut", () => {
    expect((vertexDefs.match(/attribute vec4 blade;/g) ?? []).length).toBe(1);
    expect((vertexDefs.match(/attribute float bladeStrength;/g) ?? []).length).toBe(1);
    const attr = vertexDefs.indexOf("attribute vec4 blade;");
    const before = vertexDefs.slice(0, attr);
    expect(before.lastIndexOf("#ifdef FOLIAGE_BLADES")).toBeGreaterThan(before.lastIndexOf("#ifdef FOLIAGE\n"));
    expect(before.slice(before.lastIndexOf("#ifdef FOLIAGE_BLADES"))).not.toContain("#endif");
    const strengthAttr = vertexDefs.indexOf("attribute float bladeStrength;");
    const beforeStrength = vertexDefs.slice(0, strengthAttr);
    expect(beforeStrength.lastIndexOf("#ifdef THIN_INSTANCES")).toBeGreaterThan(beforeStrength.lastIndexOf("#ifdef FOLIAGE_BLADES"));
    expect(vertexWorldPos).toContain(`const float FOLIAGE_BLADE_SOFT = ${glslFloat(FOLIAGE_BLADE_SOFT)};`);
    expect(FOLIAGE_BLADE_SOFT).toBe(BLADE_SOFT);
    expect(vertexWorldPos).toContain("vec3 bRoot = (finalWorld * vec4(blade.x, 0.0, blade.y, 1.0)).xyz;");
    expect(vertexWorldPos).toContain("float bGrow = smoothstep(foliageBladeEdges.x, foliageBladeEdges.y, fDist);");
    expect(vertexWorldPos).toContain("float bThin = smoothstep(foliageBladeEdges.z, foliageBladeEdges.w, fDist);");
    expect(vertexWorldPos).toContain("float bIn = clamp(((1.0 + FOLIAGE_BLADE_SOFT) * bGrow - blade.z) / FOLIAGE_BLADE_SOFT, 0.0, 1.0);");
    expect(vertexWorldPos).toContain("float bOut = clamp((blade.z - bThin * (1.0 + FOLIAGE_BLADE_SOFT)) / FOLIAGE_BLADE_SOFT + 1.0, 0.0, 1.0);");
    expect(vertexWorldPos).toContain("float bR2 = fract(blade.x * 37.31 + blade.y * 91.17 + 0.37);");
    expect(vertexWorldPos).toContain("float bAlive = bIn * bOut * step(bR2, bStrength);");
    expect(vertexWorldPos).toContain("worldPos.xyz = bRoot + (worldPos.xyz - bRoot) * bAlive;");
    // A non-instanced draw has no strength attribute and draws every blade.
    expect(vertexWorldPos).toContain("float bStrength = 1.0;");
    expect(vertexWorldPos).toContain("bStrength = bladeStrength;");
    // After every displacement: the bend loop and the flutter precede it.
    expect(vertexWorldPos.indexOf("bAlive")).toBeGreaterThan(vertexWorldPos.indexOf("windPlayers[i]"));
    expect(vertexWorldPos.indexOf("bAlive")).toBeGreaterThan(vertexWorldPos.indexOf("fFlutter"));
    // The motion weight ignores the edge term under the gate, and the sink is skipped.
    expect(vertexWorldPos).toContain("fEdge = 1.0;");
    expect(vertexWorldPos.indexOf("#ifndef FOLIAGE_BLADES")).toBeLessThan(vertexWorldPos.indexOf("FOLIAGE_SINK * foliageHeight"));
    // The TypeScript mirror agrees with the GLSL's second random.
    const r2 = bladeSecondRandom(0.12, -0.2);
    expect(r2).toBeCloseTo((0.12 * 37.31 + -0.2 * 91.17 + 0.37) - Math.floor(0.12 * 37.31 + -0.2 * 91.17 + 0.37), 12);
    expect(bladeAlive(0.5, 0.1, 1, 1, 0)).toBe(1);
  });

  it("declares the record uniforms, the five-player array and the per-material profile", () => {
    const mat = new PBRMaterial("m3", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.BUSH, 1.2);
    const plugin = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    const u = plugin.getUniforms();
    const names = u.ubo!.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining([
      "windDir", "windLean", "windGust", "windFlutter", "windTime", "windPlayers", "windEye",
      "foliageAmp", "foliageHeight", "foliageTint", "foliageRootAO", "foliageNormalRoot", "foliageNormalUp", "foliageFlags", "foliageEdges",
      "foliageBladeEdges",
    ]));
    const players = u.ubo!.find((x: { name: string }) => x.name === "windPlayers") as { arraySize?: number };
    expect(players.arraySize).toBe(5);
    expect(u.vertex).toContain("uniform vec3 windPlayers[5];");
    expect(u.vertex).toContain("uniform float foliageNormalUp;");
    expect(u.vertex).toContain("uniform vec4 foliageBladeEdges;");
  });

  it("binds the blade edges a shell sets, four numbers, and a no-op pair by default", () => {
    const mat = new PBRMaterial("m5", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.BLADES, 0.5);
    const plugin = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    expect(plugin.bladeEdges).toEqual([-2, -1, 1e8, 2e8]);
    setFoliageBladeEdges(mat, [2.5, 4, 6.5, 8]);
    expect(plugin.bladeEdges).toEqual([2.5, 4, 6.5, 8]);
    const writes: Record<string, number[]> = {};
    const ub = {
      updateFloat: (n: string, v: number) => { writes[n] = [v]; },
      updateFloat2: (n: string, a: number, b: number) => { writes[n] = [a, b]; },
      updateFloat3: (n: string, a: number, b: number, c: number) => { writes[n] = [a, b, c]; },
      updateFloat4: (n: string, a: number, b: number, c: number, d: number) => { writes[n] = [a, b, c, d]; },
      updateFloatArray: (n: string, v: Float32Array) => { writes[n] = Array.from(v); },
    };
    plugin.bindForSubMesh(ub as never, scene, undefined as never, undefined as never);
    expect(writes.foliageBladeEdges).toEqual([2.5, 4, 6.5, 8]);
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
    // The lean is a fraction of DRAWN height: the motion weight carries the
    // instance's uniform scale (the Y column's length).
    expect(vertexWorldPos).toContain("length(finalWorld[1].xyz)");
    // The tint guard: a material with no tint data must never mix toward black.
    expect(fragmentLights).toContain(
      "float fHas = step(1.0 / 255.0, max(vFoliage.r, max(vFoliage.g, vFoliage.b)));",
    );
    expect(fragmentLights).not.toContain("discard");
    expect(vertexDefs).not.toContain("sampler");
    // The up bias on the world normal: gated on NORMAL, applied before the
    // motion weight is computed, and hardened against a near-straight-down
    // normal yielding a zero vector.
    const normalUpLine = "vec3 fUp = vNormalW + vec3(0.0, foliageNormalUp, 0.0);";
    expect(vertexWorldPos).toContain(normalUpLine);
    expect(vertexWorldPos).toContain("vNormalW = fUl > 1.0e-4 ? fUp / fUl : vec3(0.0, 1.0, 0.0);");
    const normalUpIdx = vertexWorldPos.indexOf(normalUpLine);
    expect(vertexWorldPos.lastIndexOf("#ifdef NORMAL", normalUpIdx)).toBeGreaterThan(-1);
    expect(vertexWorldPos.slice(vertexWorldPos.lastIndexOf("#ifdef NORMAL", normalUpIdx), normalUpIdx)).not.toContain("#endif");
    expect(normalUpIdx).toBeLessThan(vertexWorldPos.indexOf("float fM ="));
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
      updateFloat4: (n: string, a: number, b: number, c: number, d: number) => { writes[n] = [a, b, c, d]; },
      updateFloatArray: (n: string, v: Float32Array) => { writes[n] = Array.from(v); },
    };
    plugin.bindForSubMesh(ubo as never, scene, engine, undefined as never);
    expect(writes.windLean).toBeCloseTo(record.lean, 10);
    expect(writes.windTime).toBeCloseTo(record.time, 10);
    expect(writes.windDir).toEqual([record.dirX, record.dirZ]);
    expect(writes.foliageEdges).toEqual([88, 110]);
    expect((writes.windPlayers as number[]).slice(0, 3)).toEqual([3, 0, 4]);
    expect(writes.foliageHeight).toBe(0.4);
    expect(writes.foliageNormalUp).toBe(FOLIAGE_PROFILES.GRASS.normalUp);
  });

  it("parks absent player slots by XZ, not Y, so the XZ-only bend never fires on them", () => {
    const mat = new PBRMaterial("m5", scene);
    attachFoliage(mat, FOLIAGE_PROFILES.GRASS, 0.4);
    const record = windRecordUnder(WEATHER_PRESETS.clear, 0);
    const positions = new Float32Array(15);
    positions[0] = 3; positions[2] = 4;
    for (let i = 1; i < 5; i++) {
      positions[i * 3] = FOLIAGE_PLAYER_PARKED;
      positions[i * 3 + 2] = FOLIAGE_PLAYER_PARKED;
    }
    setFoliageWind(record, positions);
    const plugin = mat.pluginManager!.getPlugin("Foliage") as FoliagePlugin;
    const writes: Record<string, unknown> = {};
    const ubo = {
      updateFloat: (n: string, v: number) => { writes[n] = v; },
      updateFloat2: (n: string, a: number, b: number) => { writes[n] = [a, b]; },
      updateFloat3: (n: string, a: number, b: number, c: number) => { writes[n] = [a, b, c]; },
      updateFloat4: (n: string, a: number, b: number, c: number, d: number) => { writes[n] = [a, b, c, d]; },
      updateFloatArray: (n: string, v: Float32Array) => { writes[n] = Array.from(v); },
    };
    plugin.bindForSubMesh(ubo as never, scene, engine, undefined as never);
    const written = writes.windPlayers as number[];
    expect(written.slice(0, 3)).toEqual([3, 0, 4]);
    for (let i = 1; i < 5; i++) {
      expect(written.slice(i * 3, i * 3 + 3)).toEqual([FOLIAGE_PLAYER_PARKED, 0, FOLIAGE_PLAYER_PARKED]);
    }
  });
});

describe("compiles on both shader paths (the sampler/UBO trap, pinned even with no sampler)", () => {
  async function compiledSources(targetScene: Scene, profileKey: "GRASS" | "TREE" | "BLADES"): Promise<{ vertex: string; fragment: string; defines: string }> {
    const material = new PBRMaterial(`pbr-${profileKey}`, targetScene);
    attachFoliage(material, FOLIAGE_PROFILES[profileKey], 1);
    const mesh = CreateBox(`box-${profileKey}`, {}, targetScene);
    mesh.material = material;
    if (profileKey === "BLADES") {
      mesh.setVerticesData("blade", new Float32Array(mesh.getTotalVertices() * 4), false, 4);
      mesh.setVerticesData("bladeStrength", new Float32Array(mesh.getTotalVertices()), false, 1);
    }
    const subMesh = mesh.subMeshes[0]!;
    await new Promise<void>((resolve) => {
      const tick = () => { if (material.isReadyForSubMesh(mesh, subMesh, false)) resolve(); else setTimeout(tick, 16); };
      tick();
    });
    return {
      vertex: subMesh.effect?.vertexSourceCode ?? "",
      fragment: subMesh.effect?.fragmentSourceCode ?? "",
      defines: subMesh.effect?.defines ?? "",
    };
  }
  for (const version of [1, 2]) {
    it(`webGL ${version}: the record uniforms reach both stages; the attribute only under FOLIAGE_TINT`, async () => {
      const e = new NullEngine();
      (e as unknown as { _webGLVersion: number })._webGLVersion = version;
      const s = new Scene(e);
      try {
        const grass = await compiledSources(s, "GRASS");
        for (const name of ["windDir", "windLean", "windGust", "windTime", "windPlayers", "foliageEdges", "foliageNormalUp"]) expect(grass.vertex).toContain(name);
        for (const name of ["foliageTint", "foliageRootAO", "foliageNormalRoot", "vFoliageH"]) expect(grass.fragment).toContain(name);
        const tree = await compiledSources(s, "TREE");
        for (const name of ["windDir", "windLean", "windGust", "windTime", "windPlayers", "foliageEdges"]) expect(tree.vertex).toContain(name);
        for (const name of ["foliageTint", "foliageRootAO", "foliageNormalRoot", "vFoliageH"]) expect(tree.fragment).toContain(name);
        const blades = await compiledSources(s, "BLADES");
        expect(blades.vertex).toContain("bAlive");
        expect(blades.vertex).toContain("blade");
        expect(blades.vertex).toContain("foliageNormalUp");
        expect(blades.vertex).toContain("foliageBladeEdges");
        // vertexSourceCode is the raw GLSL text handed to the driver, with every
        // #ifdef branch present verbatim (the real compiler strips them, not
        // Babylon) — so gating is checked on the actual defines the effect
        // compiled with, not by scanning that raw text for absence.
        expect(blades.defines).toContain("#define FOLIAGE_BLADES");
        expect(grass.defines).not.toContain("FOLIAGE_BLADES");
        // The base PBR fragment template carries its own ALPHATEST "discard;" as
        // dead text regardless of profile (same reason as above); the guarantee
        // that the plugin itself injects none is the static check above on
        // fragmentLights.
      } finally {
        s.dispose();
        e.dispose();
      }
    });
  }
});
