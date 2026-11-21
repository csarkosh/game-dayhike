import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WAY_FIELD_WGSL } from "../../../src/game/lite/wayFieldMesh.js";
import { WAY_LIGHT_WGSL } from "../../../src/game/lite/wayLightMeshes.js";
import { emptyWayFieldUniforms } from "../../../src/game/wayMistField.js";
import { tight } from "./wgslText.js";

const src = readFileSync(new URL("../../../src/game/lite/wayFieldMesh.ts", import.meta.url), "utf8");
// The renderer, and Day Hike's side of it (`hikeParts.ts`), where what is this game's own in a frame is written.
const renderer = readFileSync(new URL("../../../../engine/src/game/lite/renderer.ts", import.meta.url), "utf8") + readFileSync(new URL("../../../src/game/lite/hikeParts.ts", import.meta.url), "utf8");
const VERTEX = tight(WAY_FIELD_WGSL.vertex);
const FRAGMENT = tight(WAY_FIELD_WGSL.fragment);

describe("the mist beyond the way's stages on Babylon Lite", () => {
  it("reads the way's own field of noise, at its scales, drifting and curling as the way's mist does: the two are one mist", () => {
    const way = tight(WAY_LIGHT_WGSL.fragment);
    for (const line of [
      "letshapes=textureSample(wayNoise,wayNoiseSampler,plan*(1.0/11.0)+u.wayDrift.xy);",
      "letcurl=(shapes.gr-0.5)*u.wayMove.y;",
      "letheave=sin(dot(plan,vec2<f32>(0.31,0.22))-u.wayMove.z)*sin(dot(plan,vec2<f32>(-0.13,0.19))+u.wayMove.w);",
      "letface=cross(dpdx(vPlace),dpdy(vPlace));",
      "letfacing=abs(dot(face,input.fromEye))*inverseSqrt(max(dot(face,face),1.0e-20))/max(d,0.001);",
    ]) {
      expect(FRAGMENT, line).toContain(line);
      expect(way, line).toContain(line);
    }
  });

  it("comes in where the way's banks go out and fades out short of its own edge, and draws nothing where the ground is not yet known", () => {
    // A place whose ground is not yet known says it is under nothing from the way: under the reach's first metre.
    expect(FRAGMENT).toContain("letoutside=smoothstep(u.wayFieldReach.x,u.wayFieldReach.y,vField.x);");
    expect(FRAGMENT).toContain("letrim=1.0-smoothstep(u.wayFieldReach.z,u.wayFieldReach.w,d);");
    expect(FRAGMENT).toContain("lettop=mix(u.wayFieldMist.z*lift,min(vField.w*lift,vField.w*u.wayHead),standing);");
    expect(FRAGMENT).toContain("returnvec4<f32>(u.wayTint*amount,amount*u.wayFieldMist.w);");
  });

  it("reads every uniform the field is drawn with, and no other, and takes a vertex as the way's mist does", () => {
    const read = new Set([...WAY_FIELD_WGSL.fragment.matchAll(/\bu\.(way\w+)/g)].map((m) => m[1]));
    expect([...read].sort()).toEqual(Object.keys(emptyWayFieldUniforms()).sort());
    expect(VERTEX).toContain("out.field=input.color;");
    expect(VERTEX).toContain("out.fromEye=input.position-scene.vEyePosition.xyz;");
    expect(VERTEX).toContain("out.position=scene.viewProjection*vec4<f32>(input.position,1.0);");
  });
});

describe("the mist beyond the way on Babylon Lite", () => {
  it("is one mesh and one material that veils what is behind it, blended and pulled toward the eye as the way's mist is", () => {
    expect(src.match(/createShaderMaterial\(/g)).toHaveLength(1);
    expect(src.match(/createMeshFromData\(/g)).toHaveLength(1);
    expect(src).toContain('attributes: ["position", "color"],');
    expect(src).toContain("blend: PREMULTIPLIED_BLEND,");
    expect(src).toContain("depthWrite: false,");
    expect(src).toContain("backFaceCulling: false,");
    expect(src).toContain("depthBiasSlopeScale: WAY_DEPTH_SLOPE,");
    expect(src).toContain("mesh.renderOrder = SEE_THROUGH_ORDER.wayField;");
    expect(src).toContain('setShaderTexture(material, "wayNoise", wayNoiseTexture(engine));');
  });

  it("is drawn only while the way's mist is up and there is a way, and sends its vertices only when they changed", () => {
    expect(src).toContain("const now = level > 0 && way !== null && heightAt !== null;");
    expect(src).toContain("setMeshVisible(mesh, now);");
    expect(src).toContain("if (!now) return;\n      if (follow.step(eye, way as WayDown, heightAt as (x: number, z: number) => number)) {\n        updateMeshPositions(engine, mesh, follow.positions);\n        updateMeshColors(engine, mesh, follow.field);");
    expect(src).toContain('wayMistFrame("material", level, 1, mist, seconds, cast, values);');
  });

  it("is made only where no ground cloud is marched to stand beyond the banks: a forest's tiers with no chain", () => {
    expect(renderer).toContain("wayField = forest === null || chained ? null : createLiteWayField(engine, scene, uploads);");
    expect(renderer).toContain("wayField?.update(pose, wayLevel, wayMist, seconds, look.cast, way, wayHeightAt);");
    expect(renderer).toContain("wayField?.dispose();");
  });
});
