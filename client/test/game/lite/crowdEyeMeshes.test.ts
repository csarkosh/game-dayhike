import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CROWD_EYES_BLEND, CROWD_EYES_WGSL } from "../../../src/game/lite/crowdEyeMeshes.js";
import { tight } from "./wgslText.js";

const src = readFileSync(new URL("../../../src/game/lite/crowdEyeMeshes.ts", import.meta.url), "utf8");
const VERTEX = tight(CROWD_EYES_WGSL.vertex);
const FRAGMENT = tight(CROWD_EYES_WGSL.fragment);

describe("the crowd's eyes' stages on Babylon Lite", () => {
  it("lays a quad out along the camera's own right and up from the scene's view, so a pair faces the camera and is spread across the screen", () => {
    expect(VERTEX).toContain("letcrowdEye=input.tangent;");
    expect(VERTEX).toContain("letright=vec3<f32>(scene.view[0][0],scene.view[1][0],scene.view[2][0]);");
    expect(VERTEX).toContain("letupward=vec3<f32>(scene.view[0][1],scene.view[1][1],scene.view[2][1]);");
    // The eye's offset from its figure's middle, then its own corner by its half width.
    expect(VERTEX).toContain("letat=input.position+right*(crowdEye.w+crowdEye.x*crowdEye.z)+upward*(crowdEye.y*crowdEye.z);");
    expect(VERTEX).toContain("out.position=scene.viewProjection*vec4<f32>(at,1.0);");
    expect(VERTEX).toContain("out.corner=crowdEye.xy;");
    expect(VERTEX).toContain("out.colour=input.color;");
  });

  it("is a soft round light: its colour times its level, added by its roundness", () => {
    expect(FRAGMENT).toContain("letround=1.0-smoothstep(0.25,1.0,length(input.corner));");
    expect(FRAGMENT).toContain("returnvec4<f32>(input.colour.rgb*input.colour.a,round);");
    expect(CROWD_EYES_BLEND).toEqual({
      color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
      alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
    });
  });

  it("has no uniform of its own: nothing is written for a camera that moves", () => {
    expect(`${CROWD_EYES_WGSL.vertex}${CROWD_EYES_WGSL.fragment}`).not.toMatch(/shaderUniforms|shaderSystem/);
    expect(src).not.toContain("uniforms:");
  });
});

describe("the crowd's eyes on Babylon Lite", () => {
  it("is one mesh and one additive material that writes no depth, for every pair there may be, after the way's mist", () => {
    expect(src.match(/createShaderMaterial\(/g)).toHaveLength(1);
    expect(src.match(/createMeshFromData\(/g)).toHaveLength(1);
    expect(src).toContain('attributes: ["position", "tangent", "color"],');
    expect(src).toContain("blend: CROWD_EYES_BLEND,");
    expect(src).toContain("depthWrite: false,");
    expect(src).toContain("mesh.renderOrder = SEE_THROUGH_ORDER.crowdEyes;");
    expect(src).toContain("crowdEyeIndices(most), undefined, undefined, vertices.eyes, vertices.colours,");
  });

  it("is hidden with no pair, and sends its vertices only on a frame with one", () => {
    expect(src).toContain("setMeshVisible(mesh, false);\n  addToScene(scene, mesh);");
    expect(src).toContain("const drawn = writeCrowdEyes(vertices, most, figures, heights, eye, seconds, skip);\n      const now = drawn > 0;");
    expect(src).toContain("if (now) {\n        updateMeshPositions(engine, mesh, vertices.positions);\n        updateMeshTangents(engine, mesh, vertices.eyes);\n        updateMeshColors(engine, mesh, vertices.colours);");
    expect(src).toContain("removeFromScene(scene, mesh);\n      disposeMeshGpu(mesh);");
  });
});
