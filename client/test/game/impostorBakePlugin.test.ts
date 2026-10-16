import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import {
  attachImpostorBake,
  IMPOSTOR_BAKE_FRAGMENT,
  IMPOSTOR_BAKE_UNIFORM,
  ImpostorBakePlugin,
} from "../../src/game/impostorBakePlugin.js";

describe("ImpostorBakePlugin", () => {
  const engines: NullEngine[] = [];
  afterEach(() => {
    for (const e of engines.splice(0)) e.dispose();
  });

  function material(): PBRMaterial {
    const engine = new NullEngine();
    engines.push(engine);
    return new PBRMaterial("bake", new Scene(engine));
  }

  it("attaches once, writes the albedo first, and binds the mode it is set to", () => {
    const mat = material();
    const plugin = attachImpostorBake(mat);
    expect(plugin).toBeInstanceOf(ImpostorBakePlugin);
    expect(attachImpostorBake(mat)).toBe(plugin);
    expect(plugin.mode).toBe(1);
    expect(mat.pluginManager?.getPlugin("ImpostorBake")).toBe(plugin);
    const uniforms = plugin.getUniforms();
    expect(uniforms.ubo).toEqual([{ name: IMPOSTOR_BAKE_UNIFORM, size: 1, type: "float" }]);
    expect(uniforms.fragment).toBe("uniform float bakeMode;");
    const written: [string, number][] = [];
    const ubo = { updateFloat: (name: string, value: number) => written.push([name, value]) } as unknown as UniformBuffer;
    plugin.bindForSubMesh(ubo, mat.getScene(), mat.getScene().getEngine(), null as never);
    plugin.mode = 2;
    plugin.bindForSubMesh(ubo, mat.getScene(), mat.getScene().getEngine(), null as never);
    expect(written).toEqual([
      ["bakeMode", 1],
      ["bakeMode", 2],
    ]);
  });

  it("writes the two pictures at the fragment's tail, under its own define, and nothing in the vertex stage", () => {
    const plugin = attachImpostorBake(material());
    expect(plugin.getCustomCode("vertex")).toBeNull();
    expect(plugin.getCustomCode("fragment")).toEqual({ CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: IMPOSTOR_BAKE_FRAGMENT });
    // The normal in the bake's view, which is the world's frame (the bake
    // camera looks along +Z, +Y up): x and y as seen, z toward the viewer.
    expect(IMPOSTOR_BAKE_FRAGMENT).toContain("vec3 bakeN = normalize(normalW);");
    expect(IMPOSTOR_BAKE_FRAGMENT).not.toContain("view");
    expect(IMPOSTOR_BAKE_FRAGMENT).toContain("vec3(bakeN.x, bakeN.y, -bakeN.z) * 0.5 + 0.5, alpha");
    // The albedo as a colour map is stored, with the alpha the test left.
    expect(IMPOSTOR_BAKE_FRAGMENT).toContain("vec4(toGammaSpace(surfaceAlbedo), alpha)");
    expect(IMPOSTOR_BAKE_FRAGMENT.startsWith("\n#ifdef IMPOSTORBAKE\n")).toBe(true);
    expect(IMPOSTOR_BAKE_FRAGMENT.endsWith("#endif\n")).toBe(true);
    const defines: Record<string, boolean> = {};
    plugin.prepareDefines(defines as never, null as never, null as never);
    expect(defines).toEqual({ IMPOSTORBAKE: true });
  });
});
