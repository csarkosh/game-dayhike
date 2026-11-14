import { describe, expect, it } from "vitest";
import type { MaterialPlugin } from "@babylonjs/lite";
import { COVER_GREEN, FOLIAGE_ALBEDO_FLOOR } from "../../../src/game/coverAlbedoParams.js";
import { DEADWOOD_CONTACT, DEADWOOD_LOG_DRAW, deadwoodUniforms, emptyDeadwoodUniforms } from "../../../src/game/deadwoodParams.js";
import { emptyFadeUniforms, fadeBands } from "../../../src/game/distanceFade.js";
import {
  FOLIAGE_CANOPY_SKY, FOLIAGE_PLAYERS, FOLIAGE_PLAYER_PARKED, FOLIAGE_PROFILES, emptyFoliageUniforms, foliageLook, foliageUniforms,
  setFoliageWind,
} from "../../../src/game/foliageUniforms.js";
import { conformUniforms } from "../../../src/game/groundConform.js";
import { ATMOSPHERE_PRIORITY } from "../../../src/game/lite/atmospherePlugin.js";
import {
  CONFORM_FIELDS, DEADWOOD_FIELDS, FADE_FIELDS, FADE_ROWS_FIELD, FOLIAGE_FIELDS, PLAYERS_FIELD, baseColourPlugin, directOcclusionPlugin,
  oneSidedLightPlugin, surfaceWetPlugin, vegetationInstanceLayout, vegetationPlugin, wgslFloat, writeVegetationInstances,
  type Vegetation,
} from "../../../src/game/lite/forestPlugins.js";
import { WET_FIELDS } from "../../../src/game/lite/wetWgsl.js";
import { MOSS_ROUGHNESS, MOSS_TILE } from "../../../src/game/mossParams.js";
import { WET_CAP, WET_SWASH_VECS, emptyWetUniforms, wetUniforms } from "../../../src/game/wetSurface.js";
import { WIND_K1, WIND_OMEGA_FLUTTER, type WindRecord } from "../../../src/game/windParams.js";
import { laidOut, readUniform, standInTexture } from "./pluginFixture.js";

const EYE = { x: 7, y: 8, z: 9 };
const FRAME = { height: 637 };
const MOSS = standInTexture("moss");
const NOTHING: Vegetation = { eye: EYE, frame: FRAME, foliage: null, match: false, light: false, fade: false, conform: false, moss: null, deadwood: null, sky: false };
const sway = () => {
  const look = foliageLook("tree", FOLIAGE_PROFILES.TREE, 14.5);
  look.edges = [50, 70];
  return look;
};
/** The four kinds of material the trees wear, and the dead trees'. */
const crownNear = (): Vegetation => ({ ...NOTHING, foliage: sway(), fade: true, conform: true });
const crownFar: Vegetation = { ...NOTHING, fade: true, conform: true };
const barkNear = (): Vegetation => ({ ...NOTHING, foliage: sway(), conform: true, moss: MOSS });
const barkFar: Vegetation = { ...NOTHING, conform: true, moss: MOSS };
const deadwood = (base = 1.9): Vegetation => ({ ...NOTHING, fade: true, moss: MOSS, deadwood: { base } });

const code = (plugin: MaterialPlugin, stage: "vertex" | "fragment"): string => Object.values(plugin.getCustomCode?.(stage) ?? {}).join("\n");
const names = (plugin: MaterialPlugin): string[] => (plugin.getUniforms?.().ubo ?? []).map((field) => field.name);
const reads = (text: string): string[] => [...new Set([...text.matchAll(/\bmaterial\.(\w+)/g)].map((m) => m[1] as string))];

describe("a number as a WGSL float", () => {
  it("takes its point where it is whole", () => {
    expect([wgslFloat(3), wgslFloat(-2), wgslFloat(0.25), wgslFloat(12.5663706144)]).toEqual(["3.0", "-2.0", "0.25", "12.5663706144"]);
  });
});

describe("the forest's plugin on Babylon Lite: an instance's own data", () => {
  it("is the fade's bands, the ground's gradient, the foliage's tint and a dead tree's role, each only where the material reads it", () => {
    expect(vegetationInstanceLayout(crownNear())).toEqual({ fadeBands: 0, groundGrad: 4, foliage: -1, deadwoodRole: -1, floats: 6 });
    expect(vegetationInstanceLayout(barkFar)).toEqual({ fadeBands: -1, groundGrad: 0, foliage: -1, deadwoodRole: -1, floats: 2 });
    expect(vegetationInstanceLayout(deadwood())).toEqual({ fadeBands: 0, groundGrad: -1, foliage: -1, deadwoodRole: 4, floats: 5 });
    // A tinting profile carries the ground's colour and the sky's openness.
    const fern = { ...NOTHING, foliage: foliageLook("fern", FOLIAGE_PROFILES.UNDERSTORY, 1), fade: true };
    expect(vegetationInstanceLayout(fern)).toEqual({ fadeBands: 0, groundGrad: -1, foliage: 4, deadwoodRole: -1, floats: 8 });
    expect(vegetationInstanceLayout(NOTHING).floats).toBe(0);
  });

  it("declares each as an instance attribute at its bytes of one stride, and none for a material that reads none", () => {
    expect(vegetationPlugin(crownNear()).getInstanceAttributes?.()).toEqual([
      { name: "fadeBands", type: "vec4<f32>", format: "float32x4", stride: 24, offset: 0 },
      { name: "groundGrad", type: "vec2<f32>", format: "float32x2", stride: 24, offset: 16 },
    ]);
    expect(vegetationPlugin(deadwood()).getInstanceAttributes?.()).toEqual([
      { name: "fadeBands", type: "vec4<f32>", format: "float32x4", stride: 20, offset: 0 },
      { name: "deadwoodRole", type: "f32", format: "float32", stride: 20, offset: 16 },
    ]);
    expect(vegetationPlugin(NOTHING).getInstanceAttributes).toBeUndefined();
  });

  it("interleaves a bucket's arrays an instance, over what the array held, and reads no array the material does not", () => {
    const layout = vegetationInstanceLayout(crownNear());
    const out = new Float32Array(3 * layout.floats).fill(-9);
    const bands = fadeBands([30, 36], [61, 70]);
    writeVegetationInstances(layout, 2, { fadeBands: new Float32Array([...bands, ...bands]), groundGrad: new Float32Array([0.1, 0.2, 0.3, 0.4]), deadwoodRole: new Float32Array([1, 1]) }, out);
    expect([...out]).toEqual([30, 36, 61, 70, 0.1, 0.2, 30, 36, 61, 70, 0.3, 0.4, -9, -9, -9, -9, -9, -9].map((v) => Math.fround(v)));
  });

  it("refuses a bucket handed no array for an attribute its material reads, or too short a one", () => {
    const layout = vegetationInstanceLayout(deadwood());
    const out = new Float32Array(2 * layout.floats);
    expect(() => writeVegetationInstances(layout, 2, { fadeBands: new Float32Array(8) }, out)).toThrow(/deadwoodRole/);
    expect(() => writeVegetationInstances(layout, 2, { fadeBands: new Float32Array(4), deadwoodRole: new Float32Array(2) }, out)).toThrow(/fadeBands/);
  });
});

describe("the forest's plugin on Babylon Lite: its uniforms", () => {
  it("declares each part's uniforms by the record's names and sizes, read by both stages, the players as five vec4s of bits", () => {
    expect(FOLIAGE_FIELDS.map((field) => field.name)).toEqual(Object.keys(emptyFoliageUniforms()));
    expect(FOLIAGE_FIELDS.find((field) => field.name === "windPlayers")).toEqual(PLAYERS_FIELD);
    expect(PLAYERS_FIELD.type).toBe(`array<vec4<u32>,${FOLIAGE_PLAYERS}>`);
    expect(FADE_FIELDS.map((field) => field.name)).toEqual([...Object.keys(emptyFadeUniforms()), FADE_ROWS_FIELD.name]);
    expect(FADE_ROWS_FIELD).toEqual({ name: "fadeRows", type: "f32", visibility: "vertex-fragment" });
    expect(CONFORM_FIELDS.map((field) => [field.name, field.type])).toEqual([["gcRamp", "f32"], ["gcOvershoot", "f32"]]);
    expect(DEADWOOD_FIELDS.map((field) => [field.name, field.type])).toEqual([["deadwoodBark", "vec4<f32>"], ["deadwoodAxis", "vec2<f32>"]]);
    for (const field of [...FOLIAGE_FIELDS, ...FADE_FIELDS, ...CONFORM_FIELDS, ...DEADWOOD_FIELDS]) expect(field.visibility, field.name).toBe("vertex-fragment");
    expect(Object.fromEntries(FOLIAGE_FIELDS.map((field) => [field.name, field.type]))).toMatchObject({
      windDir: "vec2<f32>", windTime: "f32", windEye: "vec3<f32>", foliageBladeEdges: "vec4<f32>",
    });
  });

  it("declares the uniforms of the parts a material carries, and no others", () => {
    expect(names(vegetationPlugin(crownNear()))).toEqual([...FOLIAGE_FIELDS, ...FADE_FIELDS, ...CONFORM_FIELDS].map((field) => field.name));
    expect(names(vegetationPlugin(crownFar))).toEqual([...FADE_FIELDS, ...CONFORM_FIELDS].map((field) => field.name));
    expect(names(vegetationPlugin(barkFar))).toEqual(CONFORM_FIELDS.map((field) => field.name));
    expect(names(vegetationPlugin(deadwood()))).toEqual([...FADE_FIELDS, ...DEADWOOD_FIELDS].map((field) => field.name));
    expect(names(vegetationPlugin(NOTHING))).toEqual([]);
  });

  it("writes what the game's records hold at each write: the wind, the eye and the frame as they then stand", () => {
    const wind: WindRecord = { dirX: 0.6, dirZ: -0.8, speed: 0.5, lean: 0.02, gustAmp: 0.03, flutterAmp: 0.004, time: 12.5 };
    const players = new Float32Array(FOLIAGE_PLAYERS * 3).fill(FOLIAGE_PLAYER_PARKED);
    players.set([1, 2, 3], 0);
    setFoliageWind(wind, players);
    const eye = { x: 7, y: 8, z: 9 };
    const frame = { height: 637 };
    const v = { ...crownNear(), eye, frame };
    const plugin = vegetationPlugin(v);
    const { data, offsets } = laidOut(plugin);
    plugin.writeUbo?.(data, offsets);
    const { windPlayers, ...scalars } = foliageUniforms(v.foliage!, eye, emptyFoliageUniforms());
    for (const [name, value] of Object.entries(scalars)) expect(readUniform(data, offsets, name, value.length), name).toEqual([...value].map(Math.fround));
    // Each player's place is a vec4: its three floats and a fourth left at nothing.
    const packed = readUniform(data, offsets, "windPlayers", FOLIAGE_PLAYERS * 4);
    for (let i = 0; i < FOLIAGE_PLAYERS; i++) expect(packed.slice(i * 4, i * 4 + 4)).toEqual([...windPlayers.subarray(i * 3, i * 3 + 3), 0]);
    expect(readUniform(data, offsets, "foliageEdges", 2)).toEqual([50, 70]);
    expect(readUniform(data, offsets, "fadeEye", 3)).toEqual([7, 8, 9]);
    expect(readUniform(data, offsets, "fadeWiden", 3)[2]).toBe(0);
    expect(readUniform(data, offsets, "fadeRows", 1)).toEqual([637]);
    expect(readUniform(data, offsets, "gcRamp", 1)).toEqual([Math.fround(conformUniforms().gcRamp[0])]);
    // The eye and the frame are read where they stand at the next write.
    eye.x = 100;
    frame.height = 480;
    plugin.writeUbo?.(data, offsets);
    expect(readUniform(data, offsets, "windEye", 3)).toEqual([100, 8, 9]);
    expect(readUniform(data, offsets, "fadeRows", 1)).toEqual([480]);
    setFoliageWind({ dirX: 1, dirZ: 0, speed: 0, lean: 0, gustAmp: 0, flutterAmp: 0, time: 0 }, new Float32Array(FOLIAGE_PLAYERS * 3).fill(FOLIAGE_PLAYER_PARKED));
  });

  it("writes the dead trees' lay with the snag's base as measured since the plugin was made", () => {
    const v = deadwood(0);
    const plugin = vegetationPlugin(v);
    const { data, offsets } = laidOut(plugin);
    (v.deadwood as { base: number }).base = 1.9;
    plugin.writeUbo?.(data, offsets);
    const want = deadwoodUniforms(1.9, emptyDeadwoodUniforms());
    expect(readUniform(data, offsets, "deadwoodBark", 4)).toEqual(want.deadwoodBark.map(Math.fround));
    expect(readUniform(data, offsets, "deadwoodAxis", 2)).toEqual(want.deadwoodAxis.map(Math.fround));
  });

  it("reads in its WGSL only uniforms it declares, each as the material's", () => {
    for (const [what, v] of Object.entries({ crownNear: crownNear(), crownFar, barkNear: barkNear(), barkFar, deadwood: deadwood() })) {
      const plugin = vegetationPlugin(v);
      const declared = names(plugin);
      const read = reads(`${code(plugin, "vertex")}\n${code(plugin, "fragment")}`);
      for (const name of read) expect(declared, `${what} reads ${name}`).toContain(name);
      // A tree's profile neither tints nor is lit by the foliage's own term, so those uniforms are declared and not read.
      const unread = declared.filter((name) => !read.includes(name));
      expect(unread.filter((name) => !/^(foliageCanopySun|foliageBladeEdges)$/.test(name)), what).toEqual([]);
    }
  });
});

describe("the forest's plugin on Babylon Lite: what it compiles", () => {
  it("keys its pipeline by its parts alone: two looks of one kind share a pipeline", () => {
    expect(vegetationPlugin(crownNear()).defines).toEqual(vegetationPlugin(crownNear()).defines);
    const kinds = [crownNear(), crownFar, barkNear(), barkFar, deadwood()].map((v) => JSON.stringify(vegetationPlugin(v).defines));
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(vegetationPlugin(deadwood(1)).defines).toEqual(vegetationPlugin(deadwood(2)).defines);
  });

  it("moves one running world position through the wind, the widening and the conform, and makes the clip position from it once", () => {
    const vertex = code(vegetationPlugin(crownNear()), "vertex");
    expect(vertex).toContain("var w=out.worldPos;");
    expect(vertex).toContain("let o=finalWorld[3].xz;");
    const order = ["foliageGust(o,", "material.fadeWiden.z*smoothstep", "material.gcOvershoot*dot(gcOff,groundGrad)", "out.clipPos=scene.viewProjection*vec4<f32>(w,1.0);"].map((s) => vertex.indexOf(s));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(vertex.split("out.clipPos=").length - 1).toBe(1);
    // The world normal keeps its length: Lite's tangent frame takes it for its third axis.
    expect(vertex).toContain("out.worldNormal=fUp/fUl*fNl;");
    // The wind's constants are the game's.
    expect(vertex).toContain(`sin(${wgslFloat(WIND_K1)}*u-`);
    expect(vertex).toContain(`${wgslFloat(WIND_OMEGA_FLUTTER)}*material.windTime`);
  });

  it("leaves the wind and the foliage's colour block out of a far LOD, and keeps its fade and conform", () => {
    const plugin = vegetationPlugin(crownFar);
    expect(code(plugin, "vertex")).not.toContain("foliageGust");
    expect(code(plugin, "vertex")).toContain("out.vFadeBands=fadeBands;");
    expect(code(plugin, "fragment")).not.toContain("FOLIAGE_ALBEDO_FLOOR");
    expect(plugin.getVaryings?.().map((v) => v.name)).toEqual(["vFadeBands", "vFadeDist"]);
  });

  it("discards by the fade before any texture is read, on a noise whose rows are counted from the frame's bottom", () => {
    const fragment = vegetationPlugin(crownFar).getCustomCode?.("fragment") ?? {};
    expect(fragment.CUSTOM_FRAGMENT_MAIN_BEGIN).toContain("dfNoise(vec2<f32>(input.clipPos.x,material.fadeRows-input.clipPos.y))");
    expect(fragment.CUSTOM_FRAGMENT_MAIN_BEGIN).toContain("if(dfIn<1.0-dfN||dfOut<dfN){discard;}");
    expect(vegetationPlugin(barkFar).getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_MAIN_BEGIN).toBeUndefined();
  });

  it("floors the foliage's albedo at the cover's floor after the colour block, and turns the normal to the viewer", () => {
    const lights = vegetationPlugin(crownNear()).getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    expect(code(vegetationPlugin(crownNear()), "fragment")).toContain(`const FOLIAGE_CARD_GREEN:vec3<f32>=vec3<f32>(${COVER_GREEN.r},${COVER_GREEN.g},${COVER_GREEN.b});`);
    expect(code(vegetationPlugin(crownNear()), "fragment")).toContain(`const FOLIAGE_ALBEDO_FLOOR:vec3<f32>=vec3<f32>(${FOLIAGE_ALBEDO_FLOOR.r},${FOLIAGE_ALBEDO_FLOOR.g},${FOLIAGE_ALBEDO_FLOOR.b});`);
    expect(lights.indexOf("surfaceAlbedo=max(surfaceAlbedo,FOLIAGE_ALBEDO_FLOOR);")).toBeGreaterThan(lights.indexOf("input.vFoliageClump-0.5"));
    expect(lights).toContain("N=faceForward(N,-V,N);");
    // A tree is not matched to the ground.
    expect(lights).not.toContain("if(fHas>0.5)");
    expect(vegetationPlugin({ ...crownNear(), match: true }).getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toContain("if(fHas>0.5)");
  });

  it("lays the moss over a bark after the foliage's block, with its roughness, on a sampler of its own", () => {
    const plugin = vegetationPlugin(barkNear());
    const lights = plugin.getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    expect(lights.indexOf("mossSampler")).toBeGreaterThan(lights.indexOf("FOLIAGE_ALBEDO_FLOOR"));
    expect(lights).toContain(`textureSample(mossSampler,mossSamplerSampler,input.uv*${wgslFloat(MOSS_TILE)})`);
    expect(lights).toContain(`roughness=mix(roughness,${wgslFloat(MOSS_ROUGHNESS)},mossW);`);
    expect(lights).toContain("input.vMoss.x");
    expect(code(plugin, "vertex")).toContain("out.vMoss=vec2<f32>(position.y,mossHash(o));");
    expect(plugin.getSamplers?.()).toEqual([{ texture: "mossSampler", sampler: "mossSamplerSampler" }]);
    const bound: { texture: unknown }[] = [];
    plugin.bindTextures?.(bound as never);
    expect(bound).toEqual([{ texture: MOSS }]);
    const active: unknown[] = [];
    plugin.getActiveTextures?.(active as never);
    expect(active).toEqual([MOSS]);
    expect(vegetationPlugin(crownFar).getSamplers).toBeUndefined();
  });

  it("lays a dead tree's bark along its trunk in the vertex stage, and its moss by its role", () => {
    const plugin = vegetationPlugin(deadwood());
    const vertex = code(plugin, "vertex");
    expect(vertex).toContain("out.uv=vec2<f32>(dwTurn*dwTiles,dwAlong);");
    expect(vertex).toContain("out.vDeadwood=vec4<f32>(deadwoodRole,(position.x+material.deadwoodBark.w)*dwScale,position.y,mossHash(o));");
    const lights = plugin.getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    expect(lights).toContain(`mix(${wgslFloat(DEADWOOD_LOG_DRAW)},1.0,input.vDeadwood.w)`);
    expect(lights).toContain(`mix(${wgslFloat(DEADWOOD_CONTACT)},1.0,`);
    expect(plugin.getVaryings?.().map((v) => v.name)).toEqual(["vFadeBands", "vFadeDist", "vDeadwood"]);
    expect(() => vegetationPlugin({ ...deadwood(), moss: null })).toThrow(/moss/);
  });

  it("takes the foliage's own light and the canopy's cut of the sky only where it is told to", () => {
    const plain = vegetationPlugin(crownNear()).getCustomCode?.("fragment") ?? {};
    expect(plain.CUSTOM_FRAGMENT_LIGHT).toBeUndefined();
    expect(plain.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toBeUndefined();
    const lit = vegetationPlugin({ ...crownNear(), light: true, sky: true }).getCustomCode?.("fragment") ?? {};
    expect(lit.CUSTOM_FRAGMENT_LIGHT).toContain("material.foliageCanopySun");
    expect(lit.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toContain(`1.0-${wgslFloat(FOLIAGE_CANOPY_SKY)}*(1.0-input.vFoliage.a)`);
    expect(() => vegetationPlugin({ ...NOTHING, light: true })).toThrow(/foliage/);
  });
});

describe("how a forest material is lit and wetted on Babylon Lite", () => {
  it("starts its colour block from the base colour, and splits the colour after the wet look, under the weather's share", () => {
    const wet = surfaceWetPlugin(emptyWetUniforms());
    const base = baseColourPlugin();
    expect(base.getCustomCode?.("fragment")).toEqual({ CUSTOM_FRAGMENT_BEFORE_LIGHTS: "surfaceAlbedo=baseColor;" });
    const fragment = wet.getCustomCode?.("fragment") ?? {};
    // The weather glosses the roughness where the map's is known, and keeps the albedo's share for the split.
    expect(fragment.CUSTOM_FRAGMENT_UPDATE_DIFFUSE).toContain("var wetShare=1.0;");
    expect(fragment.CUSTOM_FRAGMENT_UPDATE_DIFFUSE).not.toContain("baseColor");
    const lights = fragment.CUSTOM_FRAGMENT_BEFORE_LIGHTS ?? "";
    expect(lights.indexOf("let fBase=surfaceAlbedo*wetShare;")).toBeGreaterThan(lights.indexOf("WET_ROUGHNESS,wetW"));
    expect(lights).toContain("colorF0=mix(dielectricColorF0,fBase,metallic);");
    expect(lights).toContain("surfaceAlbedo=fBase*(vec3<f32>(1.0)-vec3<f32>(dielectricF0)*surfaceReflectivityColor)*(1.0-metallic);");
    expect(base.getCustomCode?.("vertex")).toBeNull();
    expect(wet.getCustomCode?.("vertex")).toBeNull();
  });

  it("runs the base colour, the occlusion's and the forest's blocks, the wet look and the air in that order, the one-sided light first of all", () => {
    const order = [oneSidedLightPlugin(), baseColourPlugin(), directOcclusionPlugin(), vegetationPlugin(NOTHING), surfaceWetPlugin(emptyWetUniforms())].map((p) => p.priority);
    expect([...order, ATMOSPHERE_PRIORITY]).toEqual([50, 100, 150, 200, 240, 900]);
  });

  it("declares the wet look's uniforms and writes a surface's at its cap", () => {
    const values = emptyWetUniforms();
    const plugin = surfaceWetPlugin(values);
    expect(plugin.getUniforms?.().ubo).toEqual(WET_FIELDS);
    const { data, offsets } = laidOut(plugin);
    wetUniforms({ line: 1.3, level: 1, centre: [10, 20], radius: 300, kd: [0.3, 0.2, 0.1], attenuate: true, cap: WET_CAP.leaf }, values);
    plugin.writeUbo?.(data, offsets);
    expect(readUniform(data, offsets, "wetCap", 1)).toEqual([Math.fround(WET_CAP.leaf)]);
    expect(readUniform(data, offsets, "wetCentre", 2)).toEqual([10, 20]);
    expect(readUniform(data, offsets, "wetSwash", WET_SWASH_VECS * 4)).toEqual([...values.wetSwash]);
    const read = reads(code(plugin, "fragment"));
    for (const name of read) expect(WET_FIELDS.map((field) => field.name), name).toContain(name);
  });

  it("takes the map's occlusion out of the lights' diffuse where the colour is composed", () => {
    expect(directOcclusionPlugin().getCustomCode?.("fragment")).toEqual({ CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: "{color-=directDiffuse*(1.0-occlusion);}" });
    expect(directOcclusionPlugin().getCustomCode?.("vertex")).toBeNull();
  });

  it("undoes the turn of the normal on a back face, where Lite has just made it", () => {
    expect(oneSidedLightPlugin().getCustomCode?.("fragment")).toEqual({ CUSTOM_FRAGMENT_UPDATE_DIFFUSE: "if(!frontFacing){N=-N;N_geom=-N_geom;}" });
    expect(oneSidedLightPlugin().getCustomCode?.("vertex")).toBeNull();
  });
});
