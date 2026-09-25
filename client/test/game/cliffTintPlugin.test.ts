import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { CLIFF_GROUND_TINT, CliffTintPlugin, attachCliffTint } from "../../src/game/cliffTintPlugin.js";

const fx = (name: string) => readFileSync(new URL(`../../src/game/shaders/${name}`, import.meta.url), "utf8");
function glslFloat(n: number): string { return Number.isInteger(n) ? `${n}.0` : `${n}`; }

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => engine.dispose());

describe("cliff tint plugin", () => {
  it("attaches once, idempotently, and activates", () => {
    const mat = new PBRMaterial("c", scene);
    attachCliffTint(mat);
    attachCliffTint(mat);
    const plugin = mat.pluginManager?.getPlugin("CliffTint");
    expect(plugin).toBeInstanceOf(CliffTintPlugin);
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active).toContain(plugin);
    expect(active.filter((p) => p instanceof CliffTintPlugin)).toHaveLength(1);
  });

  it("declares the foliage attribute and injects at the world-position and before-lights hooks only", () => {
    const mat = new PBRMaterial("c2", scene);
    attachCliffTint(mat);
    const plugin = mat.pluginManager!.getPlugin("CliffTint") as CliffTintPlugin;
    const attributes: string[] = [];
    plugin.getAttributes(attributes, scene, undefined as never);
    expect(attributes).toEqual(["foliage"]);
    const v = plugin.getCustomCode("vertex")!;
    expect(Object.keys(v).sort()).toEqual(["CUSTOM_VERTEX_DEFINITIONS", "CUSTOM_VERTEX_UPDATE_WORLDPOS"]);
    const f = plugin.getCustomCode("fragment")!;
    expect(Object.keys(f).sort()).toEqual(["CUSTOM_FRAGMENT_BEFORE_LIGHTS", "CUSTOM_FRAGMENT_DEFINITIONS"]);
    expect(plugin.getCustomCode("compute")).toBeNull();
  });

  it("mixes the albedo halfway toward the ground under the module, from the same GLSL the files hold", () => {
    const mat = new PBRMaterial("c3", scene);
    attachCliffTint(mat);
    const plugin = mat.pluginManager!.getPlugin("CliffTint") as CliffTintPlugin;
    const f = plugin.getCustomCode("fragment")!;
    expect(CLIFF_GROUND_TINT).toBe(0.5);
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toContain(`const float CLIFF_GROUND_TINT = ${glslFloat(CLIFF_GROUND_TINT)};`);
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toContain("surfaceAlbedo = mix(surfaceAlbedo, vCliffTint.rgb, CLIFF_GROUND_TINT * cHas);");
    expect(f.CUSTOM_FRAGMENT_DEFINITIONS).toBe(fx("cliffTint.fragment.fx"));
    expect(f.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toBe(fx("cliffTintLights.fragment.fx"));
    const v = plugin.getCustomCode("vertex")!;
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toBe(fx("cliffTint.vertex.fx"));
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toBe(fx("cliffTintWorldPos.vertex.fx"));
    // The attribute exists only on thin instances; elsewhere the default
    // black rgb tells the fragment stage there is no tint data.
    expect(v.CUSTOM_VERTEX_DEFINITIONS).toContain("#ifdef THIN_INSTANCES\nattribute vec4 foliage;\n#endif");
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toContain("vCliffTint = vec4(0.0, 0.0, 0.0, 1.0);");
    expect(v.CUSTOM_VERTEX_UPDATE_WORLDPOS).toContain("#ifdef THIN_INSTANCES\n  vCliffTint = foliage;\n#endif");
  });

  it("sets CLIFFTINT in prepareDefines", () => {
    const mat = new PBRMaterial("c4", scene);
    attachCliffTint(mat);
    const plugin = mat.pluginManager!.getPlugin("CliffTint") as CliffTintPlugin;
    const defines: Record<string, boolean> = { CLIFFTINT: false };
    plugin.prepareDefines(defines as never, scene, undefined as never);
    expect(defines.CLIFFTINT).toBe(true);
  });
});
