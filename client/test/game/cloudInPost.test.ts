import { describe, it, expect, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import type { Effect } from "@babylonjs/core/Materials/effect.js";
import atmosphereFragment from "../../src/game/shaders/atmosphereFog.fragment.fx?raw";
import farSoftFragment from "../../src/game/shaders/farSoft.fragment.fx?raw";
import { createAtmosphere, type Atmosphere } from "../../src/game/atmosphere.js";
import { CLOUD_SIGMA } from "../../src/game/cloudParams.js";
import { FAR_CLOUD_UNIFORMS } from "../../src/game/post.js";
import { FOG_DISTANCE } from "../../src/sim/forestConstants.js";

/** One GLSL function's text, from its signature to its closing brace. */
function glslFunction(source: string, name: string): string {
  const m = new RegExp(`\\n(vec2|vec3|float) ${name}\\(`).exec(source);
  expect(m, name).not.toBeNull();
  const start = (m as RegExpExecArray).index + 1;
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is not closed`);
}

/** The calls a fake effect is handed, by uniform name. */
function recording(): { effect: Effect; calls: Map<string, unknown[]> } {
  const calls = new Map<string, unknown[]>();
  const effect = new Proxy({}, { get: (_t, fn: string) => (name: string, ...args: unknown[]) => calls.set(`${fn}:${name}`, args) }) as unknown as Effect;
  return { effect, calls };
}

describe("the ground cloud marched once a pixel (2026-10-18)", () => {
  let atmosphere: Atmosphere | null = null;
  afterEach(() => {
    atmosphere?.dispose();
    atmosphere = null;
  });

  it("marches with the atmosphere's own three functions, to the letter", () => {
    for (const name of ["atmCloudGround", "atmCloudAt", "atmCloudDepth"]) {
      expect(glslFunction(farSoftFragment, name)).toBe(glslFunction(atmosphereFragment, name));
    }
    // And their constants.
    for (const line of ["const float ATM_CLOUD_EDGE = 0.5 / 64.0;", "const int ATM_CLOUD_STEPS_MAX = 12;"]) {
      expect(atmosphereFragment).toContain(line);
      expect(farSoftFragment).toContain(line);
    }
  });

  it("declares every uniform it marches with, and the pass names each of them", () => {
    for (const name of FAR_CLOUD_UNIFORMS) expect(farSoftFragment).toMatch(new RegExp(`uniform (float|vec2|vec3|vec4) ${name};`));
    expect(farSoftFragment).toContain("uniform sampler2D atmCloudMap;");
    // The ray: the depth over the ray's share of the camera's forward axis, and no cloud on the far sky.
    expect(farSoftFragment).toContain("float t = d / max(dot(rd, farForward), 1.0e-4);");
    expect(farSoftFragment).toContain("if (atmCloudSteps > 0.5 && d < FAR_SOFT_SKY) {");
    // Over the softened colour by its optical depth, as the materials mixed it over the fogged one.
    expect(farSoftFragment).toContain("col = mix(cloud, col, exp(-od));");
    expect(atmosphereFragment).toContain("return mix(cloud, fogged, exp(-od));");
  });

  it("binds its cloud to a pass: the steps where it has density, none by day, its map and the sun", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    atmosphere = createAtmosphere(scene, FOG_DISTANCE);
    // No record yet: no steps.
    atmosphere.setCloud(0.8, 8, 10);
    let r = recording();
    atmosphere.bindCloud(r.effect);
    expect(r.calls.get("setFloat:atmCloudSteps")).toEqual([0]);
    expect(r.calls.get("setTexture:atmCloudMap")).toHaveLength(1);
    expect(r.calls.has("setFloat3:atmSunDir")).toBe(true);
    expect(r.calls.get("setFloat:atmCloudDensity")).toEqual([CLOUD_SIGMA * 0.8]);
    // The same writer feeds the materials and the pass: every one of the pass's cloud uniforms is bound.
    for (const name of FAR_CLOUD_UNIFORMS.filter((n) => n.startsWith("atm"))) {
      expect([...r.calls.keys()].some((k) => k.endsWith(`:${name}`)), name).toBe(true);
    }
    // By day (no density) the march takes no steps either way.
    atmosphere.setCloud(0, 8, 10);
    r = recording();
    atmosphere.bindCloud(r.effect);
    expect(r.calls.get("setFloat:atmCloudSteps")).toEqual([0]);
    atmosphere.setCloudInPost(true);
    scene.dispose();
    engine.dispose();
  });

  it("is switched into the chain by the renderer where the chain reads the depth", async () => {
    const { readFileSync } = await import("node:fs");
    const renderer = readFileSync(new URL("../../src/game/renderer.ts", import.meta.url), "utf8");
    expect(renderer).toContain("atmosphere.setCloudInPost(true);");
    expect(renderer).toContain("post.setCloud((effect) => atmosphere.bindCloud(effect));");
    const atmosphereSource = readFileSync(new URL("../../src/game/atmosphere.ts", import.meta.url), "utf8");
    // The materials bind no steps while the chain marches it.
    expect(atmosphereSource).toContain("cloudInPost ? 0 : cloudSteps(),");
  });
});
