import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { attachWind, WindPlugin } from "../../src/game/windPlugin.js";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

describe("wind plugin", () => {
  it("registers once per material, idempotently", () => {
    const mat = new PBRMaterial("m", scene);
    attachWind(mat, 0.06, 0.45);
    attachWind(mat, 0.06, 0.45); // second attach must be a no-op
    const plugin = mat.pluginManager?.getPlugin("Wind");
    expect(plugin).toBeInstanceOf(WindPlugin);

    // `getPlugin` only proves the plugin is registered in `_plugins`; a real
    // render dispatches prepareDefines/bindForSubMesh/custom-code injection
    // over `_activePlugins` instead (materialPluginManager.pure.js's
    // `_handlePluginEvent*` methods all iterate `this._activePlugins`, not
    // `this._plugins`), which only `_enable(true)` populates. That field is
    // private and NullEngine cannot compile shaders to prove activation any
    // other way, so this cast-and-poke is load-bearing: without it, a plugin
    // that registers but never activates (e.g. a missing `_enable(true)`)
    // passes every other assertion in this file while silently never
    // running in a real render.
    const activePlugins = (mat.pluginManager as unknown as { _activePlugins: unknown[] })
      ._activePlugins;
    expect(activePlugins).toContain(plugin);
  });

  it("injects at the world-position hook with height-squared weighting", () => {
    const mat = new PBRMaterial("m2", scene);
    attachWind(mat, 0.05, 1.0);
    const plugin = mat.pluginManager!.getPlugin("Wind") as WindPlugin;
    const code = plugin.getCustomCode("vertex");
    expect(code).not.toBeNull();
    // The injection point is load-bearing: CUSTOM_VERTEX_UPDATE_POSITION runs
    // before the thin-instance world transform, where world-position phase is
    // unavailable — the plugin must use CUSTOM_VERTEX_UPDATE_WORLDPOS.
    expect(Object.keys(code!)).toContain("CUSTOM_VERTEX_UPDATE_WORLDPOS");
    const glsl = code!.CUSTOM_VERTEX_UPDATE_WORLDPOS!;
    expect(glsl).toContain("windMeshHeight");
    expect(glsl).toContain("windH * windH"); // tips move, bases anchored
    expect(code!.CUSTOM_VERTEX_UPDATE_POSITION).toBeUndefined();
  });

  it("declares the WIND define and its uniforms", () => {
    const mat = new PBRMaterial("m3", scene);
    attachWind(mat, 0.05, 1.0);
    const plugin = mat.pluginManager!.getPlugin("Wind") as WindPlugin;
    const defines: Record<string, boolean> = { WIND: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines.WIND).toBe(true);
    const uniforms = plugin.getUniforms();
    const names = uniforms.ubo!.map((u: { name: string }) => u.name);
    expect(names).toEqual(expect.arrayContaining(["windTime", "windAmp", "windMeshHeight"]));
  });
});
