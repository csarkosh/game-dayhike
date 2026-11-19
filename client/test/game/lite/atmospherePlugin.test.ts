import { describe, expect, it } from "vitest";
import { atmosphereUniforms, emptyAtmosphereUniforms, type AtmosphereRecord } from "../../../src/game/atmosphereParams.js";
import { noCloud } from "../../../src/game/cloudParams.js";
import { ATMOSPHERE_PRIORITY, atmospherePlugin } from "../../../src/game/lite/atmospherePlugin.js";
import { laidOut, readUniform, standInTexture } from "./pluginFixture.js";

const RECORD: AtmosphereRecord = {
  baseDensity: 0.0004, heightDensity: 0.004, heightFalloff: 0.05, referenceLevel: -20, gradientScale: 1 / 4000,
  sunDir: { x: 0.6, y: 0, z: 0.8 }, sunColour: { r: 1, g: 0.8, b: 0.6 }, sunWeight: 0.5, sunPower: 8,
  farColour: { r: 0.4, g: 0.5, b: 0.6 },
};
const MAP = standInTexture("cloud map");

describe("the atmosphere's plugin on Babylon Lite", () => {
  it("declares a field for every uniform the atmosphere is drawn with, by its name and size", () => {
    const uniforms = emptyAtmosphereUniforms();
    const fields = atmospherePlugin(uniforms, MAP).getUniforms?.().ubo ?? [];
    expect(fields.map((field) => field.name)).toEqual(Object.keys(uniforms));
    expect(Object.fromEntries(fields.map((field) => [field.name, field.type]))).toMatchObject({
      atmOn: "f32", atmBaseDensity: "f32", atmSunDir: "vec3<f32>", atmFarColour: "vec3<f32>",
      atmCloudNoiseScale: "vec2<f32>", atmCloudGroundRect: "vec4<f32>",
    });
  });

  it("writes the record it was given as it stands at each write: the same record filled again is written again", () => {
    const uniforms = emptyAtmosphereUniforms();
    const plugin = atmospherePlugin(uniforms, MAP);
    const { data, offsets } = laidOut(plugin);
    plugin.writeUbo?.(data, offsets);
    expect(readUniform(data, offsets, "atmOn", 1)).toEqual([0]);
    atmosphereUniforms(RECORD, noCloud(), 0, uniforms);
    plugin.writeUbo?.(data, offsets);
    for (const [name, value] of Object.entries(uniforms)) {
      expect(readUniform(data, offsets, name, value.length), name).toEqual([...value].map((x) => Math.fround(x)));
    }
    expect(readUniform(data, offsets, "atmOn", 1)).toEqual([1]);
    expect(readUniform(data, offsets, "atmSunDir", 3)).toEqual([0.6, 0, 0.8].map((x) => Math.fround(x)));
  });

  it("reads in its WGSL exactly the uniforms it declares, each as the material's", () => {
    const uniforms = emptyAtmosphereUniforms();
    const code = Object.values(atmospherePlugin(uniforms, MAP).getCustomCode?.("fragment") ?? {}).join("\n");
    const read = new Set([...code.matchAll(/\bmaterial\.(\w+)/g)].map((m) => m[1]));
    expect([...read].sort()).toEqual(Object.keys(uniforms).sort());
    // No uniform is read bare: every `atm…` name in the code but the functions and the map is the material's.
    const bare = [...code.matchAll(/(?<![.\w])(atm[A-Z]\w*)/g)].map((m) => m[1] as string).filter((name) => name in uniforms);
    expect(bare).toEqual([]);
  });

  it("fogs the lit colour before the final colour is composed, after every plugin that shades the surface, and adds nothing to the vertex stage", () => {
    const plugin = atmospherePlugin(emptyAtmosphereUniforms(), MAP);
    expect(plugin.priority).toBe(ATMOSPHERE_PRIORITY);
    expect(ATMOSPHERE_PRIORITY).toBeGreaterThan(250);
    expect(plugin.getCustomCode?.("vertex")).toBeNull();
    expect(plugin.getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toBe(
      "color=atmosphereFog(color,input.worldPos,scene.vEyePosition.xyz);",
    );
  });

  it("binds the cloud's map with a sampler of its own", () => {
    const plugin = atmospherePlugin(emptyAtmosphereUniforms(), MAP);
    expect(plugin.getSamplers?.()).toEqual([{ texture: "atmCloudMap", sampler: "atmCloudMapSampler" }]);
    const bound: { texture: unknown; sampler?: false }[] = [];
    plugin.bindTextures?.(bound as never);
    expect(bound).toEqual([{ texture: MAP }]);
    const active: unknown[] = [];
    plugin.getActiveTextures?.(active as never);
    expect(active).toEqual([MAP]);
  });

  it("leaves the ground cloud to a post chain where it is told to: no march, no map, and another program", () => {
    const marching = atmospherePlugin(emptyAtmosphereUniforms(), MAP);
    const plain = atmospherePlugin(emptyAtmosphereUniforms(), MAP, undefined, false);
    const code = (plugin: typeof plain): string => plugin.getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_DEFINITIONS ?? "";
    expect(code(marching)).toMatch(/fn atmCloudDepth\(/);
    expect(code(marching)).toContain("if(material.atmCloudSteps<0.5){return fogged;}");
    expect(code(plain)).not.toMatch(/atmCloudDepth|atmCloudAt|atmCloudGround|atmCloudMap|atmCloudSteps/);
    // The fog itself is the same text either way, to the haze's last statement.
    const fog = (text: string): string => text.slice(text.indexOf("fn atmosphereFog("), text.indexOf("fogged=mix(mix(air,material.atmSunColour"));
    expect(fog(code(plain))).toBe(fog(code(marching)));
    expect(fog(code(plain)).length).toBeGreaterThan(400);
    expect(code(plain).trimEnd().endsWith("return fogged;\n}")).toBe(true);
    expect(plain.getSamplers).toBeUndefined();
    expect(plain.bindTextures).toBeUndefined();
    expect(plain.getActiveTextures).toBeUndefined();
    expect(plain.defines).toEqual({ cloud: false, grade: false, curve: false });
    expect(marching.defines).toEqual({ cloud: true, grade: false, curve: false });
  });

  it("grades the material's own colour where the tier has no post chain: the vignette on the fogged colour, the curves and the dither last", () => {
    const shared = { name: "hikeFrame" } as never;
    const graded = atmospherePlugin(emptyAtmosphereUniforms(), MAP, shared, false, true);
    const code = graded.getCustomCode?.("fragment") ?? {};
    expect(code.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toBe("color=atmosphereFog(color,input.worldPos,scene.vEyePosition.xyz);color=gradeVignette(color,input.clipPos.xy);");
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toBe("color=gradeDither(gradeCurves(color),input.clipPos.xy);");
    expect(code.CUSTOM_FRAGMENT_DEFINITIONS).toContain("fn gradeVignette(");
    expect(graded.defines).toEqual({ cloud: false, grade: true, curve: false });
    const plain = atmospherePlugin(emptyAtmosphereUniforms(), MAP, shared, false).getCustomCode?.("fragment") ?? {};
    expect(plain.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toBeUndefined();
    expect(plain.CUSTOM_FRAGMENT_DEFINITIONS).not.toContain("gradeVignette");
    // Where Lite's materials no longer end with the display curve (the page has drawn a tier with a chain), the
    // plugin lays it on itself, ahead of the curves, and is another program for it.
    const encoding = atmospherePlugin(emptyAtmosphereUniforms(), MAP, shared, false, true, true);
    const encoded = encoding.getCustomCode?.("fragment") ?? {};
    expect(encoded.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toBe("color=displayEncoded(color,hikeFrame.frameContrast);color=gradeDither(gradeCurves(color),input.clipPos.xy);");
    expect(encoded.CUSTOM_FRAGMENT_DEFINITIONS).toContain("fn displayEncoded(");
    expect(code.CUSTOM_FRAGMENT_DEFINITIONS).not.toContain("displayEncoded");
    expect(encoding.defines).toEqual({ cloud: false, grade: true, curve: true });
    expect(() => atmospherePlugin(emptyAtmosphereUniforms(), MAP, shared, false, false, true)).toThrow(/material path's grade/);
    // The grade's numbers are the frame's block's: a material that carries its own air cannot have it.
    expect(() => atmospherePlugin(emptyAtmosphereUniforms(), MAP, undefined, false, true)).toThrow(/frame's block/);
  });
});
