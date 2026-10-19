import { describe, it, expect, beforeAll } from "vitest";
import { Effect } from "@babylonjs/core/Materials/effect.js";
import "@babylonjs/core/Shaders/ShadersInclude/shadowsFragmentFunctions.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { ShaderCodeInliner } from "@babylonjs/core/Engines/Processors/shaderCodeInliner.js";
import "@babylonjs/core/Shaders/ShadersInclude/helperFunctions.js";
import { translatorInput, uniformityOff } from "../../src/game/wgslFormat.js";
import { startTranslators, translateStage, type StartedTranslators } from "../../../tools/wgsl/lib/translators.mjs";
import { drawnEffect, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";
import {
  FILTER_TAPS,
  SEARCH_TAPS,
  SOFT_SHADOW_INCLUDE,
  UNROLLED_MARK,
  functionSpan,
  installSoftShadows,
  poissonTable,
  unrolledSoftShadows,
} from "../../src/game/softShadowInclude.js";

const babylon = (): string => Effect.IncludesShadersStore[SOFT_SHADOW_INCLUDE]!;

/** The text of one function: from its head to the end of its body. */
const functionText = (include: string, name: string): string => {
  const span = functionSpan(include, name);
  expect(span).not.toBeNull();
  return include.slice(span!.head, span!.end);
};

describe("the soft shadow's taps without their array", () => {
  it("reads Babylon's 64-entry Poisson table as it is written", () => {
    const table = poissonTable(babylon());
    expect(table).toHaveLength(64);
    expect(table[0]).toEqual(["0.06407013", "0.05409927"]);
    expect(table[1]).toEqual(["0.7366577", "0.5789394"]);
    // The 32-tap table holds its 32 and is padded to 64 with `vec3(0.)`, a scalar for all three.
    expect(table[31]).toEqual(["0.4402924", "0.3640312"]);
    expect(table[32]).toEqual(["0.", "0."]);
    expect(table[63]).toEqual(["0.", "0."]);
  });

  it("unrolls the 32-tap cascaded function alone: its taps literal, its signature and the rest of the include kept", () => {
    const base = babylon();
    const out = unrolledSoftShadows(base);
    expect(out).toContain(UNROLLED_MARK);
    // Inside the guard: a stage with no shadows keeps its text, and its recorded translation.
    expect(out.indexOf(UNROLLED_MARK)).toBe(out.indexOf("#ifdef SHADOWS\n") + "#ifdef SHADOWS\n".length);
    const fn = functionText(out, "computeShadowWithCSMPCSS32");
    // The signature as Babylon declares it.
    expect(fn.startsWith(functionText(base, "computeShadowWithCSMPCSS32").split("\n")[0]!)).toBe(true);
    // No array, no loop, no call into the array-taking function.
    expect(fn).not.toContain("PoissonSamplers32");
    expect(fn).not.toContain("poissonSamplers");
    expect(fn).not.toContain("for (");
    expect(fn).not.toContain("computeShadowWithCSMPCSS(");
    expect(fn.match(/texture2D\(depthSampler,/g)).toHaveLength(SEARCH_TAPS);
    expect(fn.match(/texture2D\(shadowSampler,/g)).toHaveLength(FILTER_TAPS);
    // The first blocker tap and the first filter tap carry the table's first entry.
    expect(fn).toContain("searchScale*vec2(0.06407013,0.05409927)");
    expect(fn).toContain("((0.06407013)*rotationVector.x-(0.05409927)*rotationVector.y)*filterRadius.x");
    // A negative entry after a minus would read as a decrement without its parentheses.
    expect(fn).toContain("((-0.874181)*rotationVector.x-(-0.04579735)*rotationVector.y)*filterRadius.x");
    expect(fn).not.toContain("--");
    // The same arithmetic as Babylon's: the penumbra, its darkness, the fall-off and the no-blocker early out.
    expect(fn).toContain("float penumbraRatio=((depthMetric-avgBlockerDepth)*depthCorrection+AAOffset);");
    expect(fn).toContain(`shadow/=${FILTER_TAPS}.;shadow=mix(shadow,1.,min((depthMetric-avgBlockerDepth)*depthCorrection*penumbraDarkness,1.));shadow=mix(darkness,1.,shadow);if (numBlocker<1.0) {return 1.0;}`);
    expect(fn).toContain("{return computeFallOff(shadow,clipSpace.xy,frustumEdgeFalloff);}}");
    expect(fn).toContain("#ifdef USE_REVERSE_DEPTHBUFFER");
    // Everything else is Babylon's own text: the array-taking function, the 16- and 64-tap wrappers, the table.
    for (const name of ["computeShadowWithCSMPCSS", "computeShadowWithCSMPCSS16", "computeShadowWithCSMPCSS64", "computeShadowWithPCSS32", "computeShadowWithPCF3"]) {
      expect(functionText(out, name)).toBe(functionText(base, name));
    }
    expect(out).toContain("const vec3 PoissonSamplers32[64]=vec3[64](");
    expect(out.length - base.length).toBeGreaterThan(2000);
  });

  it("is rewritten once: the unrolled text comes back as it is", () => {
    const once = unrolledSoftShadows(babylon());
    expect(unrolledSoftShadows(once)).toBe(once);
  });

  it("installs the unrolled text in a store, once", () => {
    const store: Record<string, string> = { [SOFT_SHADOW_INCLUDE]: babylon() };
    const text = installSoftShadows(store);
    expect(store[SOFT_SHADOW_INCLUDE]).toBe(text);
    expect(text).toContain(UNROLLED_MARK);
    expect(installSoftShadows(store)).toBe(text);
    expect(() => installSoftShadows({})).toThrow("not registered");
  });
});

describe("the soft shadow's taps, compiled", () => {
  let translators: StartedTranslators;
  beforeAll(async () => {
    translators = await startTranslators();
  }, timeLimit(60_000));

  // A material that calls the 32-tap cascaded filter as the lit materials
  // do, through the include Babylon's processor expands and inlines, with the
  // defines the cascaded soft path sets. (The generator itself cannot be
  // built on NullEngine, `lighting.test.ts`.)
  const VERTEX = "attribute vec3 position;uniform mat4 worldViewProjection;void main(void){gl_Position=worldViewProjection*vec4(position,1.);}";
  const FRAGMENT = [
    "precision highp float;",
    "#define WEBGPU",
    "#define SHADOWS",
    "#define SHADOWFLOAT",
    "#define SHADOWCSM0",
    "#define SHADOWPCSS0",
    "#include<helperFunctions>",
    "#include<shadowsFragmentFunctions>",
    "uniform highp sampler2DArray depthS;",
    "uniform highp sampler2DArrayShadow shadowS;",
    "uniform vec4 lightPos;",
    "uniform float depthMetric;",
    "void main(void){float s=computeShadowWithCSMPCSS32(0.,lightPos,depthMetric,depthS,shadowS,1./2048.,0.15,0.17,0.,vec2(1.),1.,1.);gl_FragColor=vec4(s);}",
  ].join("\n");

  it("reach a receiver's fragment as literals through Babylon's processor and translate to WGSL with no 64-entry array", async () => {
    installSoftShadows();
    const engine = webgpuProcessingEngine();
    const scene = new Scene(engine);
    try {
      scene.activeCamera = new UniversalCamera("eye", new Vector3(0, 2, 0), scene);
      const ground = MeshBuilder.CreateGround("ground", { width: 4, height: 4 }, scene);
      ground.material = new ShaderMaterial("receiver", scene, { vertexSource: VERTEX, fragmentSource: FRAGMENT }, {
        attributes: ["position"],
        uniforms: ["worldViewProjection", "lightPos", "depthMetric"],
        samplers: ["depthS", "shadowS"],
      });
      const effect = await drawnEffect(ground);
      // The WebGPU engine inlines the functions the include marks (`#define
      // inline`) before it translates (its `inlineShaderCode`; the WebGL
      // engines' is a no-op), which is how a sampler built by a macro reaches
      // its read. The same inliner, run by hand.
      const inliner = new ShaderCodeInliner(effect._fragmentSourceCode);
      inliner.processCode();
      const code = inliner.code;
      const defines = (effect as unknown as { defines: string }).defines;
      // The include's rewritten function, inlined by Babylon: the taps as literals, no array read.
      expect(code).toContain(UNROLLED_MARK);
            expect(code).toContain("searchScale*vec2(0.06407013,0.05409927)");
      // The inliner takes the functions it inlined out of the text, the array-taking one with them.
      expect(code).not.toContain("PoissonSamplers32[i]");
      expect(code).not.toContain("poissonSamplers[i]");
      expect(code.match(/texture\(shadowS/g)?.length ?? 0).toBeGreaterThanOrEqual(FILTER_TAPS);
      const wgsl = translateStage(translators, { stage: "fragment", flag: uniformityOff(code), glsl: translatorInput(code, defines) });
      // The first tap's offset, as WGSL spells the float.
      expect(wgsl).toMatch(/0\.0640701/);
      expect(wgsl).not.toMatch(/array<vec3<?f32>?, ?64u?>/);
      expect(wgsl).not.toContain("PoissonSamplers32");
      expect(wgsl.match(/textureSampleCompare/g)?.length ?? 0).toBeGreaterThanOrEqual(FILTER_TAPS);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  }, timeLimit(60_000));
});
