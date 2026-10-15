import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import vertexDefs from "../../src/game/shaders/deadwood.vertex.fx?raw";
import vertexUv from "../../src/game/shaders/deadwoodUv.vertex.fx?raw";
import fragmentDefs from "../../src/game/shaders/deadwood.fragment.fx?raw";
import fragmentLights from "../../src/game/shaders/deadwoodLights.fragment.fx?raw";
import mossFragmentDefs from "../../src/game/shaders/moss.fragment.fx?raw";
import {
  attachDeadwood, DeadwoodPlugin, DEADWOOD_MOSS_SAMPLER, DEADWOOD_ROLE_ATTRIBUTE, DEADWOOD_ROUGHNESS_INJECTION_CODE,
} from "../../src/game/deadwoodPlugin.js";
import { MOSS_ROUGHNESS_INJECTION_POINT, MOSS_SAMPLER } from "../../src/game/mossPlugin.js";
import { DEADWOOD_AXIS, DEADWOOD_BARK, DEADWOOD_CONTACT, DEADWOOD_CONTACT_BAND, DEADWOOD_LOG_DRAW, DEADWOOD_RADIUS, DEADWOOD_TONE, DEADWOOD_UP } from "../../src/game/deadwoodParams.js";
import { BARK_FOOTPRINT, barkTransform } from "../../src/game/barkParams.js";

let engine: NullEngine;
let scene: Scene;
beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterAll(() => {
  scene.dispose();
  engine.dispose();
});

const glslFloat = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);
const mossMap = (s: Scene): BaseTexture => RawTexture.CreateRGBATexture(new Uint8Array([60, 110, 40, 255]), 1, 1, s);

describe("deadwood plugin", () => {
  it("attaches once per material with the forest's moss map, and hands back the one there", () => {
    const material = new PBRMaterial("deadwood", scene);
    const map = mossMap(scene);
    const first = attachDeadwood(material, map);
    expect(first).toBeInstanceOf(DeadwoodPlugin);
    expect(attachDeadwood(material, mossMap(scene))).toBe(first);
    expect(first.texture).toBe(map);
    expect(first.base).toBe(0);
    expect(first.name).toBe("Deadwood");
    expect(first.priority).toBe(215);
  });

  it("injects the .fx files verbatim at the four points and the moss's roughness anchor, and nothing else", () => {
    const plugin = attachDeadwood(new PBRMaterial("deadwood2", scene), mossMap(scene));
    expect(plugin.getCustomCode("vertex")).toEqual({ CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_MAIN_END: vertexUv });
    expect(plugin.getCustomCode("fragment")).toEqual({
      CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: fragmentLights,
      [MOSS_ROUGHNESS_INJECTION_POINT]: DEADWOOD_ROUGHNESS_INJECTION_CODE,
    });
    expect(plugin.getCustomCode("compute")).toBeNull();
    expect(DEADWOOD_ROUGHNESS_INJECTION_CODE).toBe(
      "\n#ifdef DEADWOOD\nreflectivityOut.roughness=mix(reflectivityOut.roughness,MOSS_ROUGHNESS,mossW);\n#endif\nfloat microSurface=reflectivityOut.microSurface;",
    );
  });

  it("declares the role attribute, one varying, the moss plugin's sampler and two uniforms on both paths", () => {
    const plugin = attachDeadwood(new PBRMaterial("deadwood3", scene), mossMap(scene));
    const attributes: string[] = [];
    plugin.getAttributes(attributes, scene, scene.meshes[0]!);
    expect(attributes).toEqual([DEADWOOD_ROLE_ATTRIBUTE]);
    expect(vertexDefs).toContain(`attribute float ${DEADWOOD_ROLE_ATTRIBUTE};`);
    expect(vertexDefs.split("varying vec4 vDeadwood;").length - 1).toBe(1);
    expect(fragmentDefs.split("varying vec4 vDeadwood;").length - 1).toBe(1);
    const samplers: string[] = [];
    plugin.getSamplers(samplers);
    expect(samplers).toEqual([DEADWOOD_MOSS_SAMPLER]);
    expect(DEADWOOD_MOSS_SAMPLER).toBe(MOSS_SAMPLER);
    expect(fragmentDefs).toContain(`uniform sampler2D ${MOSS_SAMPLER};`);
    const uniforms = plugin.getUniforms();
    expect(uniforms.ubo).toEqual([
      { name: "deadwoodBark", size: 4, type: "vec4" },
      { name: "deadwoodAxis", size: 2, type: "vec2" },
    ]);
    expect(uniforms.vertex).toBe("uniform vec4 deadwoodBark;\nuniform vec2 deadwoodAxis;");
    expect(uniforms.fragment).toBe("");
  });

  it("lays the bark's coordinates along the trunk and round it at the instance's scale, a whole number of tiles round, over the mesh's first uv set and any map's own", () => {
    const block = vertexUv.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("//"));
    expect(block).toEqual([
      "#ifdef DEADWOOD",
      "{",
      "float dwScale = length(finalWorld[0].xyz);",
      "float dwAlong = positionUpdated.x * dwScale * deadwoodBark.x;",
      "float dwTurn = atan(positionUpdated.y - deadwoodAxis.x, positionUpdated.z - deadwoodAxis.y) / 6.283185307179586;",
      "float dwTiles = max(1.0, floor(6.283185307179586 * deadwoodBark.z * dwScale * deadwoodBark.y + 0.5));",
      "vec2 dwUv = vec2(dwTurn * dwTiles, dwAlong);",
      "#ifdef MAINUV1",
      "vMainUV1 = dwUv;",
      "#endif",
      "#if defined(ALBEDO) && ALBEDODIRECTUV == 0",
      "vAlbedoUV = dwUv;",
      "#endif",
      "#if defined(BUMP) && BUMPDIRECTUV == 0",
      "vBumpUV = dwUv;",
      "#endif",
      "#if defined(REFLECTIVITY) && REFLECTIVITYDIRECTUV == 0",
      "vReflectivityUV = dwUv;",
      "#endif",
      "vDeadwood = vec4(deadwoodRole, (positionUpdated.x + deadwoodBark.w) * dwScale, positionUpdated.y, deadwoodHash(finalWorld[3].xz));",
      "}",
      "#endif",
    ]);
    // The dressing lays no repeats of its own: the plugin's coordinates are the set's metres.
    expect(barkTransform(DEADWOOD_BARK)).toEqual({ uScale: 1, vScale: 1, wAng: 0 });
    expect(DEADWOOD_BARK).toEqual({ set: "pine", along: "v", alongRepeat: 1, roundRepeat: 1, fine: true });
  });

  it("keeps every constant in lockstep with the GLSL, the moss's as the moss plugin's own", () => {
    for (const line of mossFragmentDefs.split("\n").filter((l) => l.startsWith("const "))) expect(fragmentDefs).toContain(line);
    expect(fragmentDefs).toContain(`const vec2 DEADWOOD_UP = vec2(${DEADWOOD_UP[0]}, ${DEADWOOD_UP[1]});`);
    expect(fragmentDefs).toContain("const vec2 DEADWOOD_UP = vec2(-0.1, 0.55);");
    expect(fragmentDefs).toContain(`const float DEADWOOD_LOG_DRAW = ${DEADWOOD_LOG_DRAW};`);
    expect(DEADWOOD_LOG_DRAW).toBe(0.7);
    expect(DEADWOOD_TONE).toEqual({ r: 0.5, g: 0.5, b: 0.53 });
    expect(fragmentDefs).toContain(`const float DEADWOOD_CONTACT = ${glslFloat(DEADWOOD_CONTACT)};`);
    expect(fragmentDefs).toContain(`const vec2 DEADWOOD_CONTACT_BAND = vec2(${DEADWOOD_CONTACT_BAND[0]}, ${DEADWOOD_CONTACT_BAND[1]});`);
    expect(DEADWOOD_RADIUS).toBe(0.3);
    expect(DEADWOOD_AXIS).toEqual({ y: 0.2, z: 0.03 });
    expect(BARK_FOOTPRINT[DEADWOOD_BARK.set]).toEqual({ width: 2.0, height: 2.0 });
  });

  it("masks a log's moss by the normal's rise over its whole length and a snag's as a trunk's, then darkens a log toward its underside", () => {
    const block = fragmentLights.slice(fragmentLights.indexOf("{"), fragmentLights.lastIndexOf("}"));
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("//") && l !== "{");
    expect(lines).toEqual([
      "vec3 dwN = normalize(vNormalW);",
      "float dwLog = vDeadwood.x;",
      "float dwBand = mix(1.0 - smoothstep(MOSS_BAND.x, MOSS_BAND.y, vDeadwood.y), 1.0, dwLog);",
      "float dwSide = mix(smoothstep(0.0, MOSS_SIDE_EDGE, dot(dwN, MOSS_SIDE)), smoothstep(DEADWOOD_UP.x, DEADWOOD_UP.y, dwN.y), dwLog);",
      "float dwTree = mix(MOSS_AMOUNT.x, MOSS_AMOUNT.y, mix(vDeadwood.w, mix(DEADWOOD_LOG_DRAW, 1.0, vDeadwood.w), dwLog));",
      "vec3 mossColour = texture2D(mossSampler, vAlbedoUV * MOSS_TILE).rgb;",
      "#ifdef GAMMAALBEDO",
      "mossColour = toLinearSpace(mossColour);",
      "#endif",
      "float mossLuma = dot(mossColour, MOSS_LUMA);",
      "float mossRaw = dwBand * dwSide * dwTree;",
      "mossW = smoothstep(MOSS_EDGE.x, MOSS_EDGE.y, mossRaw * (0.5 + mossLuma));",
      "surfaceAlbedo = mix(surfaceAlbedo, mossColour * MOSS_TINT, mossW);",
      "float dwContact = mix(DEADWOOD_CONTACT, 1.0, smoothstep(DEADWOOD_CONTACT_BAND.x, DEADWOOD_CONTACT_BAND.y, vDeadwood.z));",
      "surfaceAlbedo *= mix(1.0, dwContact, dwLog);",
    ]);
    expect(fragmentLights).toContain("#if defined(DEADWOOD) && defined(ALBEDO)\nfloat mossW = 0.0;\n{\n");
  });
});
