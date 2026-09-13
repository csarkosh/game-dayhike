import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Process } from "@babylonjs/core/Engines/Processors/shaderProcessor.js";
import type { _IProcessingOptions } from "@babylonjs/core/Engines/Processors/shaderProcessingOptions.js";
import { WebGL2ShaderProcessor } from "@babylonjs/core/Engines/WebGL/webGL2ShaderProcessors.js";
import {
  attachGroundConform,
  conformDisplacement,
  GroundConformPlugin,
  GROUND_CONFORM_OVERSHOOT,
  GROUND_CONFORM_RAMP,
} from "../../src/game/groundConformPlugin.js";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterAll(() => { scene.dispose(); engine.dispose(); });

function pluginFor(name: string): GroundConformPlugin {
  const mat = new PBRMaterial(name, scene);
  attachGroundConform(mat);
  return mat.pluginManager!.getPlugin("GroundConform") as GroundConformPlugin;
}

describe("ground conform plugin", () => {
  it("registers once per material and activates through the manager", () => {
    const mat = new PBRMaterial("g1", scene);
    attachGroundConform(mat);
    attachGroundConform(mat);
    const plugin = mat.pluginManager?.getPlugin("GroundConform");
    expect(plugin).toBeInstanceOf(GroundConformPlugin);
    // Activation is what makes prepareDefines/bindForSubMesh/custom code run
    // at all: Babylon dispatches over _activePlugins, not _plugins. And a
    // second attach would leave TWO active plugins — _addPlugin dedups by
    // name and returns false silently, but the discarded instance's own
    // _enable(true) still reaches _activatePlugin, which dedups by IDENTITY.
    // That would inject the GLSL twice and redeclare gcOff, which will not
    // compile. `toContain` alone cannot see it.
    const active = (mat.pluginManager as unknown as { _activePlugins: unknown[] })._activePlugins;
    expect(active).toContain(plugin);
    expect(active.filter((p) => p instanceof GroundConformPlugin)).toHaveLength(1);
  });

  it("declares the per-instance gradient attribute", () => {
    const attrs: string[] = [];
    pluginFor("g2").getAttributes(attrs, scene, undefined as never);
    expect(attrs).toContain("groundGrad");
  });

  it("injects at the worldpos hook and nowhere else", () => {
    const plugin = pluginFor("g3");
    const vert = plugin.getCustomCode("vertex");
    expect(Object.keys(vert!)).toContain("CUSTOM_VERTEX_UPDATE_WORLDPOS");
    expect(plugin.getCustomCode("fragment")).toBeNull();
  });
});

function processInjected(source: string, defines: string[]): Promise<string> {
  const options: _IProcessingOptions = {
    defines,
    indexParameters: {},
    isFragment: false,
    shouldUseHighPrecisionShader: true,
    supportsUniformBuffers: true,
    shadersRepository: "",
    includesShadersStore: {},
    processor: new WebGL2ShaderProcessor(),
    version: "300",
    platformName: "WEBGL2",
    processingContext: null,
    isNDCHalfZRange: false,
    useReverseDepthBuffer: false,
  };
  return new Promise((resolve) => { Process(source, options, (m) => resolve(m)); });
}

/**
 * Everything above asserts on the strings the plugin RETURNS, which is
 * necessary and not sufficient. `terrainTexture.ts` shipped a dead feature
 * past exactly those assertions because a comment inside its injected GLSL
 * spelled a hashed preprocessor keyword, and Babylon's line-based
 * preprocessor read it as a real directive — swallowing the next real endif
 * and the code between. NullEngine compiles no GLSL and cannot see that;
 * Babylon's string preprocessor runs perfectly well in plain Node.
 */
describe("injected GLSL survives Babylon's real preprocessor", () => {
  it("keeps the displacement when GROUNDCONFORM and THIN_INSTANCES are both set", async () => {
    const plugin = pluginFor("g4");
    const vert = plugin.getCustomCode("vertex")!;
    const source = `${vert.CUSTOM_VERTEX_DEFINITIONS ?? ""}\nvoid main(void) {\n${vert.CUSTOM_VERTEX_UPDATE_WORLDPOS!}\n}\n`;
    const out = await processInjected(source, ["#define GROUNDCONFORM", "#define THIN_INSTANCES"]);
    expect(out).toContain("worldPos.y");
    expect(out).toContain("groundGrad");
    expect(out).toContain("min(");
    // ES 1.00 `attribute` must have been migrated to ES 3.00 `in`, proving the
    // plugin may be written in plain ES 1.00 as windPlugin and terrainTexture
    // both are.
    expect(out).not.toContain("attribute vec2 groundGrad;");
    expect(out).toContain("in vec2 groundGrad;");
  });

  it("drops the displacement without either define, proving the conditional is evaluated", async () => {
    const plugin = pluginFor("g5");
    const vert = plugin.getCustomCode("vertex")!;
    const source = `${vert.CUSTOM_VERTEX_DEFINITIONS ?? ""}\nvoid main(void) {\n${vert.CUSTOM_VERTEX_UPDATE_WORLDPOS!}\n}\n`;
    const out = await processInjected(source, []);
    expect(out).not.toContain("worldPos.y +=");
  });

  it("drops the displacement with GROUNDCONFORM set but THIN_INSTANCES absent", async () => {
    // Regression for the impostor-bake bug: `defaultBakeImpostor` clones LOD1
    // with `mesh.clone(name, null, false)`, which shares the source geometry
    // (and its `groundGrad` VertexBuffer) but draws non-instanced —
    // THIN_INSTANCES is unset for that submesh. Without this guard, the
    // non-instanced draw would read `groundGrad` element 0 for every vertex
    // via `vertexAttribDivisor(1)`: whichever tree happened to land as
    // instance 0, nondeterministically.
    const plugin = pluginFor("g4b");
    const vert = plugin.getCustomCode("vertex")!;
    const source = `${vert.CUSTOM_VERTEX_DEFINITIONS ?? ""}\nvoid main(void) {\n${vert.CUSTOM_VERTEX_UPDATE_WORLDPOS!}\n}\n`;
    const out = await processInjected(source, ["#define GROUNDCONFORM"]);
    expect(out).not.toContain("worldPos.y +=");
  });

  it("spells no hashed preprocessor keyword inside a comment", () => {
    const plugin = pluginFor("g6");
    const vert = plugin.getCustomCode("vertex")!;
    for (const block of Object.values(vert)) {
      for (const line of (block as string).split("\n")) {
        const comment = line.indexOf("//");
        if (comment < 0) continue;
        expect(line.slice(comment)).not.toMatch(/#\s*(ifdef|ifndef|endif|else|elif|if)\b/);
      }
    }
  });
});

describe("conformDisplacement mirrors the shader", () => {
  it("is zero on flat ground", () => {
    expect(conformDisplacement(2, -1, 0.05, 0, 0)).toBe(0);
  });

  it("never pushes up", () => {
    // Uphill offsets give a positive plane term, which the clamp discards: a
    // signed conform lifts the uphill half over concave ground and OPENS new
    // daylight — measured, it took the worst case from 2.44 m to 3.06 m.
    expect(conformDisplacement(2, 0, 0.05, 0.5, 0)).toBe(0);
  });

  it("pushes the downhill edge past the plane by the overshoot", () => {
    const plane = -2 * 0.5;
    const w = 1 - 0;
    expect(conformDisplacement(-2, 0, 0, 0.5, 0)).toBeCloseTo(w * GROUND_CONFORM_OVERSHOOT * plane, 9);
  });

  it("fades to nothing above the ramp height", () => {
    expect(conformDisplacement(-2, 0, GROUND_CONFORM_RAMP, 0.5, 0)).toBe(0);
    expect(Math.abs(conformDisplacement(-2, 0, GROUND_CONFORM_RAMP * 0.5, 0.5, 0)))
      .toBeLessThan(Math.abs(conformDisplacement(-2, 0, 0, 0.5, 0)));
  });

  it("follows the smoothstep curve, not merely a linear ramp", () => {
    // The RAMP*0.5 assertion above cannot distinguish smoothstep from a
    // linear ramp: both give w = 0.5 at the midpoint, which is why a mutation
    // dropping the `w` factor entirely barely moved that gate. At t = 0.25
    // (modelY = 0.2, GROUND_CONFORM_RAMP = 0.8), smoothstep's
    // `1 - t*t*(3-2t)` gives w = 0.84375, distinct from a linear ramp's 0.75.
    expect(conformDisplacement(-2, 0, 0.2, 0.5, 0)).toBeCloseTo(0.84375 * 1.5 * -1, 9);
  });
});
