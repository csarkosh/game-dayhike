import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLOUD_NOISE_LARGE_M, CLOUD_NOISE_SMALL_M } from "@csarkosh/engine/game/cloudParams";
import { SEE_THROUGH_ORDER } from "@csarkosh/engine/game/lite/drawOrder";
import { PREMULTIPLIED_BLEND, WAY_LIGHT_WGSL } from "../../../src/game/lite/wayLightMeshes.js";
import { emptyWayLightUniforms } from "../../../src/game/wayLight.js";
import { tight } from "./wgslText.js";

const src = readFileSync(new URL("../../../src/game/lite/wayLightMeshes.ts", import.meta.url), "utf8");
const VERTEX = tight(WAY_LIGHT_WGSL.vertex);
const FRAGMENT = tight(WAY_LIGHT_WGSL.fragment);

describe("the way's mist's stages on Babylon Lite", () => {
  it("reads the noise at the ground mist's two scales, which the drift's shares of a tile are of", () => {
    expect(FRAGMENT).toContain("plan*(1.0/11.0)+u.wayDrift.xy");
    expect(CLOUD_NOISE_LARGE_M).toBe(11);
    expect(FRAGMENT).toContain("plan*0.25+up*vec2<f32>(0.37,0.19)");
    expect(1 / CLOUD_NOISE_SMALL_M).toBe(0.25);
    // Two reads of the one field, each at the level its size on the screen picks.
    expect(WAY_LIGHT_WGSL.fragment.match(/textureSample\w*\(/g)).toEqual(["textureSample(", "textureSample("]);
  });

  it("holds a standing sheet's mist under the head it is built to, so no veil or fin ends in a cut edge", () => {
    expect(FRAGMENT).toContain("mix(1.0e6,vWay.w*u.wayHead,standing)");
  });

  it("gives a face too small to have a lie none, never a division by nothing: a fragment against the eye must not put a NaN in the frame", () => {
    expect(FRAGMENT).not.toContain("normalize(cross(");
    expect(FRAGMENT).toContain("letface=cross(dpdx(vPlace),dpdy(vPlace));");
    expect(FRAGMENT).toContain("inverseSqrt(max(dot(face,face),1.0e-20))/max(d,0.001)");
    expect(FRAGMENT).toContain("up/max(top,0.01)");
  });

  it("reads every uniform the mist is drawn with, and no other, in its fragment alone", () => {
    const read = new Set([...WAY_LIGHT_WGSL.fragment.matchAll(/\bu\.(way\w+)/g)].map((m) => m[1]));
    expect([...read].sort()).toEqual(Object.keys(emptyWayLightUniforms()).sort());
    expect(WAY_LIGHT_WGSL.vertex).not.toMatch(/shaderUniforms/);
  });

  it("takes a vertex as it stands in the world, its four numbers from the mesh's colour, and the eye from the scene", () => {
    expect(VERTEX).toContain("out.place=input.position;");
    expect(VERTEX).toContain("out.way=input.color;");
    expect(VERTEX).toContain("out.fromEye=input.position-scene.vEyePosition.xyz;");
    expect(VERTEX).toContain("out.position=scene.viewProjection*vec4<f32>(input.position,1.0);");
    // The view is the scene's own: no copy of it is the mist's.
    expect(`${WAY_LIGHT_WGSL.vertex}${WAY_LIGHT_WGSL.fragment}`).not.toMatch(/shaderSystem/);
    expect(FRAGMENT).toContain("letd=length(input.fromEye);");
  });

  it("goes out premultiplied: its colour times the amount, and the share of what is behind that it hides", () => {
    expect(FRAGMENT).toContain("returnvec4<f32>(u.wayTint*amount,amount*u.wayMist.w);");
    // So where it piles up it settles at its own colour and never whitens; the frame's alpha is left as it is.
    expect(PREMULTIPLIED_BLEND).toEqual({
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
    });
  });
});

describe("the way's mist on Babylon Lite", () => {
  it("is one material that veils what is behind it and writes no depth, seen from both sides, pulled toward the eye by its slope", () => {
    expect(src.match(/createShaderMaterial\(/g)).toHaveLength(1);
    expect(src).toContain('attributes: ["position", "color"],');
    expect(src).toContain("uniforms: shaderUniformDecls(values),");
    expect(src).toContain('samplers: ["wayNoise"],');
    expect(src).toContain("blend: PREMULTIPLIED_BLEND,");
    expect(src).toContain("depthWrite: false,");
    expect(src).toContain("backFaceCulling: false,");
    expect(src).toContain("depthBiasSlopeScale: WAY_DEPTH_SLOPE,");
    // The ground mist's own noise, tiling, so the way's mist is shaped as the night's is.
    expect(src).toContain("createTexture2DFromPixels(engine, cloudNoiseMap(), CLOUD_NOISE_SIZE, CLOUD_NOISE_SIZE, {");
    expect(src).toContain('addressModeU: "repeat", addressModeV: "repeat"');
  });

  it("stands between the mist banks and the rain among the see-through draws, after the crowd's cards and before the mist beyond its banks", () => {
    expect(src).toContain("mesh.renderOrder = SEE_THROUGH_ORDER.wayLight;");
    expect(SEE_THROUGH_ORDER.mist).toBeLessThan(SEE_THROUGH_ORDER.crowdCards);
    expect(SEE_THROUGH_ORDER.crowdCards).toBeLessThan(SEE_THROUGH_ORDER.wayLight);
    expect(SEE_THROUGH_ORDER.wayLight).toBeLessThan(SEE_THROUGH_ORDER.wayField);
    expect(SEE_THROUGH_ORDER.wayField).toBeLessThan(SEE_THROUGH_ORDER.crowdEyes);
    expect(SEE_THROUGH_ORDER.crowdEyes).toBeLessThan(SEE_THROUGH_ORDER.splashes);
  });

  it("builds as a patient job, a stretch a mesh, and has its pipeline asked for as the hike loads by a mesh of no size", () => {
    expect(src).toContain('jobs.begin(owner, build(way, heightAt), true, "wayLight");');
    expect(src).toContain("const data = yield* standWayChunk(way, heightAt, from, to);");
    expect(src).toContain('const seed = stand("wayLight_seed", new Float32Array(9), new Float32Array(12), new Uint32Array([0, 1, 2]));');
    // Hidden as it joins the scene, and shown at once only while the mist is up.
    expect(src).toContain("setMeshVisible(mesh, false);\n    addToScene(scene, mesh);");
    expect(src).toContain("if (shown) setMeshVisible(mesh, true);");
  });

  it("is drawn only while its level is up, and writes its uniforms only then", () => {
    expect(src).toContain("const now = level > 0;");
    expect(src).toContain("for (const mesh of meshes) setMeshVisible(mesh, now);");
    expect(src).toContain("if (!now) return;\n      wayMistFrame(path, level, undim, mist, seconds, cast, values);");
  });

  it("a new way replaces the old one's meshes and its unfinished build, none clears them, and its dispose lets all of it go", () => {
    expect(src).toContain("setWay(way, heightAt) {\n      if (disposed) return;\n      clear();\n      if (way !== null && way.xs.length > 1)");
    expect(src).toContain("jobs.cancel(owner);\n    for (const mesh of meshes) {\n      removeFromScene(scene, mesh);\n      disposeMeshGpu(mesh);\n    }");
    expect(src).toContain("clear();\n      disposed = true;\n      removeFromScene(scene, seed);\n      disposeMeshGpu(seed);");
  });
});
