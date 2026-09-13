import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
// Side-effect import, required: it populates
// `ShaderStore.IncludesShadersStore["pbrBlockFinalLitComponents"]`. Importing
// PBRMaterial alone does NOT run this — the include's source only loads when
// an effect actually compiles, which these NullEngine tests never trigger.
// Without it the anchor-pin assertion below would read `undefined` and pass
// vacuously instead of catching a real Babylon-upgrade break.
import "@babylonjs/core/Shaders/ShadersInclude/pbrBlockFinalLitComponents.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import { createCelShading, type CelShading } from "../../src/game/cel.js";

let engine: NullEngine;
let scene: Scene;
let cel: CelShading;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  cel = createCelShading(scene);
});

afterEach(() => {
  cel.dispose();
  scene.dispose();
  engine.dispose();
});

describe("createCelShading — registration, toggle, dispose", () => {
  it("attaches the plugin to PBR materials created after registration, and only those", () => {
    const pbr = new PBRMaterial("pbr", scene);
    const std = new StandardMaterial("std", scene);
    expect(pbr.pluginManager?.getPlugin("CelShading")).toBeTruthy();
    expect(std.pluginManager?.getPlugin("CelShading") ?? null).toBeNull();
  });

  it("toggles the module flag both ways without touching materials", () => {
    expect(cel.enabled).toBe(false);
    cel.setEnabled(true);
    expect(cel.enabled).toBe(true);
    cel.setEnabled(false);
    expect(cel.enabled).toBe(false);
  });

  it("dispose unregisters: materials created afterwards carry no plugin, and a second create works", () => {
    cel.dispose();
    const late = new PBRMaterial("late", scene);
    expect(late.pluginManager?.getPlugin("CelShading") ?? null).toBeNull();
    cel = createCelShading(scene); // afterEach disposes this instance
    const relit = new PBRMaterial("relit", scene);
    expect(relit.pluginManager?.getPlugin("CelShading")).toBeTruthy();
  });
});

/**
 * Guards the one failure mode the rest of this suite cannot catch: the
 * plugin's regex injection point (`!aggShadow=aggShadow/numLights;` in
 * `cel.ts`) targets a specific, unversioned line inside Babylon's own
 * `pbrBlockFinalLitComponents` shader include. If a future Babylon bump
 * renames or re-conditions that line, the regex matches nothing,
 * `getCustomCode` silently injects zero lines, and cel mode renders
 * pixel-identical to etched — a green suite and a correct-looking build with
 * the wrong screen. Pinning the anchor string here, against Babylon's own
 * shader store, turns that silent no-op into a red test at the point the
 * dependency changes, not at the point someone notices cel mode stopped
 * doing anything.
 */
describe("CelShadingPlugin — injection anchor pinned against Babylon's own shader source", () => {
  it("pbrBlockFinalLitComponents still contains the exact anchor line, exactly once", () => {
    const include = ShaderStore.IncludesShadersStore["pbrBlockFinalLitComponents"];
    expect(include).toBeTruthy();
    const anchor = "aggShadow=aggShadow/numLights;";
    // split/match count, not a bare .includes(): a rename to a near-miss
    // (e.g. two statements merged, or the assignment reordered) that still
    // happens to contain the substring should still be caught by requiring
    // exactly one whole-anchor occurrence.
    const occurrences = (include ?? "").split(anchor).length - 1;
    expect(occurrences).toBe(1);
  });

  it("declares the expected shape: null vertex code, exact fragment injection points, and the celOn uniform", () => {
    const pbr = new PBRMaterial("shapePbr", scene);
    const plugin = pbr.pluginManager?.getPlugin("CelShading");
    expect(plugin).toBeTruthy();

    expect(plugin!.getCustomCode("vertex")).toBeNull();

    const fragment = plugin!.getCustomCode("fragment");
    expect(fragment).toBeTruthy();
    expect(Object.keys(fragment ?? {}).sort()).toEqual(
      ["CUSTOM_FRAGMENT_DEFINITIONS", "!aggShadow=aggShadow/numLights;"].sort(),
    );

    const uniforms = plugin!.getUniforms();
    expect(uniforms.ubo?.[0]?.name).toBe("celOn");
  });
});
