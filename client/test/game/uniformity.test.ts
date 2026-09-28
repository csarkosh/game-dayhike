import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// The ground arrays decode images node cannot: one-texel stand-ins.
vi.mock("../../src/game/groundMaps.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/game/groundMaps.js")>();
  const { RawTexture } = await import("@babylonjs/core/Materials/Textures/rawTexture.js");
  return {
    ...actual,
    loadGroundArrays: (scene: import("@babylonjs/core/scene.js").Scene) => {
      const texture = (name: string) => {
        const made = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene);
        made.name = name;
        return made;
      };
      return { normals: texture("terrainNormals"), rah: texture("terrainRAH"), ready: Promise.resolve(), dispose() {} };
    },
  };
});

import "../../src/sim/passes/index.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { createAtmosphere } from "../../src/game/atmosphere.js";
import { createClipmap } from "../../src/game/renderer.js";
import { finishFragmentFor } from "../../src/game/post.js";
import { seedFromToken } from "../../src/game/seed.js";
import { FOG_DISTANCE } from "../../src/sim/forestConstants.js";
import { pluginsInStates } from "./helpers/pluginText.js";
import { drawnEffect, probeReady, webgpuProcessingEngine } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";
import halationExtractFragment from "../../src/game/shaders/halationExtract.fragment.fx?raw";
import gradeFragment from "../../src/game/shaders/grade.fragment.fx?raw";
import finishFragment from "../../src/game/shaders/finish.fragment.fx?raw";

/**
 * WGSL refuses a texture read with implicit derivatives (`textureSample`) in
 * non-uniform control flow, and on WebGPU every branch on a varying or a texel
 * is non-uniform. Babylon's WebGPU engine turns the analysis off for a stage
 * whose code carries `#define DISABLE_UNIFORMITY_ANALYSIS`, and its
 * cascaded-shadow include carries it, so a material that receives shadows
 * passes whatever it reads, by accident: the low tier, with no shadow, did not.
 *
 * What these tests catch: a texture read with implicit derivatives
 * (`texture2D`, `texture`, `textureProj`) written inside an `if`, `else`,
 * `for` or `while` in the fragment code of the game's own material plugins
 * and post-process passes, in any state the plugin is drawn in, in a shader
 * that does not carry the define on WebGPU. The list of such shaders and what
 * they read is pinned, so a new one is seen. And that the terrain's define
 * reaches the code Babylon's WebGPU processing hands the engine, built without
 * shadows as the low tier builds it.
 *
 * What they do not: a read after an early `return` or a `discard` under a
 * branch at the same level, a read in a `?:`, a read inside a function
 * called from a branch (the game's own functions that read under a branch
 * read with explicit gradients), and Babylon's own shader code. They count a
 * branch on a uniform as a branch too, which asks for the define where the
 * analysis would have passed.
 */

const DEFINE = "#define DISABLE_UNIFORMITY_ANALYSIS";

/** The samplers read with implicit derivatives inside a branch or a loop in `code`. */
function readsUnderBranch(code: string): string[] {
  // Comments and preprocessor lines out: an `#if` is not a branch.
  const src = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/^\s*#.*$/gm, "");
  const found = new Set<string>();
  const blocks: boolean[] = [];
  let pending = false;
  let singles = 0;
  const conditional = (): boolean => singles > 0 || blocks.includes(true);
  const ident = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);
  const closing = (from: number): number => {
    let depth = 0;
    for (let j = from; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) return j;
    }
    return src.length;
  };
  const readsIn = (text: string): void => {
    if (!conditional()) return;
    for (const m of text.matchAll(/\b(?:texture2D|texture|textureProj)\s*\(\s*(\w+)/g)) found.add(m[1] as string);
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const word = ident(src[i - 1]) ? null : /^(if|for|while|else)\b/.exec(src.slice(i));
    if (word !== null) {
      if (word[1] === "else") {
        // `else if` is the `if`'s own branch; a bare `else` opens one.
        i += 4;
        if (!/^\s*if\b/.test(src.slice(i))) pending = true;
        continue;
      }
      // A single-statement branch opened by `else` holds this one.
      if (pending) {
        singles++;
        pending = false;
      }
      const open = src.indexOf("(", i);
      const close = closing(open);
      readsIn(src.slice(open, close + 1));
      pending = true;
      i = close + 1;
      continue;
    }
    if (c === "{") {
      blocks.push(pending);
      pending = false;
      i++;
      continue;
    }
    if (c === "}") {
      blocks.pop();
      i++;
      continue;
    }
    if (pending) {
      singles++;
      pending = false;
    }
    if (c === ";") {
      singles = 0;
      i++;
      continue;
    }
    const read = /^(?:texture2D|texture|textureProj)\s*\(\s*(\w+)/.exec(src.slice(i));
    if (read !== null && !ident(src[i - 1])) {
      if (conditional()) found.add(read[1] as string);
      i += read[0].length;
      continue;
    }
    i++;
  }
  return [...found].sort();
}

/** Each plugin's fragment code in every state it is drawn in, on the engine given. */
function pluginFragments(webgpu: boolean): Record<string, string> {
  const built = pluginsInStates();
  try {
    const out: Record<string, string> = {};
    for (const { name, plugin, states, engine } of built.cases) {
      const flagged = engine as unknown as { _isWebGPU: boolean };
      const was = flagged._isWebGPU;
      flagged._isWebGPU = webgpu;
      try {
        const texts: string[] = [];
        for (const enter of states) {
          enter();
          texts.push(Object.values(plugin.getCustomCode("fragment") ?? {}).join("\n"));
        }
        out[name] = texts.join("\n");
      } finally {
        flagged._isWebGPU = was;
      }
    }
    return out;
  } finally {
    built.dispose();
  }
}

describe("WGSL's uniformity analysis and the game's shaders", () => {
  it("finds where each of the game's shaders reads a texture under a branch or a loop", () => {
    const shaders: Record<string, string> = {
      ...pluginFragments(false),
      "post.grade": gradeFragment,
      "post.halationExtract": halationExtractFragment,
      "post.finish": finishFragment,
    };
    const found = Object.fromEntries(
      Object.entries(shaders)
        .map(([name, code]) => [name, readsUnderBranch(code)] as const)
        .filter(([, reads]) => reads.length > 0),
    );
    expect(found).toEqual({
      // The finish pass's peripheral echo, under `mask > 0.0` (§6.1).
      "post.finish": ["textureSampler"],
      // The ground blend's parallax and relief gates, and the road, trail and
      // feature paints (`TERRAIN_UNIFORMITY_OFF`).
      terrain: ["featureTex", "roadAsphalt", "terrainFloor", "terrainNormals", "terrainPebble", "terrainRAH", "trailSegs"],
    });
  });

  it("marks each of them with the define on WebGPU, and leaves WebGL2's text without it", () => {
    const onWebGpu = pluginFragments(true);
    const onWebGl2 = pluginFragments(false);
    expect(onWebGpu.terrain).toContain(DEFINE);
    expect(onWebGl2.terrain).not.toContain(DEFINE);
    expect(finishFragmentFor(true)).toContain(DEFINE);
    expect(finishFragmentFor(false)).not.toContain(DEFINE);
    // No other plugin carries it: each shader turns the analysis off on its own.
    expect(Object.keys(onWebGpu).filter((name) => onWebGpu[name]?.includes(DEFINE)).sort()).toEqual(["terrain"]);
  });

  it("keeps the terrain's define in the code Babylon's WebGPU processing hands the engine, built without shadows as the low tier is", async () => {
    const engine = webgpuProcessingEngine();
    const scene = new Scene(engine);
    const atmosphere = createAtmosphere(scene, FOG_DISTANCE);
    scene.activeCamera = new UniversalCamera("player", new Vector3(0, 2, 0), scene);
    const clipmap = createClipmap(scene, seedFromToken("atmo"));
    try {
      // The material is made on a WebGL2 engine's terms; its plugin's code is
      // asked for at the compile, now as WebGPU's.
      (engine as unknown as { _isWebGPU: boolean })._isWebGPU = true;
      probeReady(scene);
      const effect = await drawnEffect(clipmap.meshes[0] as Mesh);
      expect(effect._fragmentSourceCode).toContain(DEFINE);
      // Not from Babylon's cascaded-shadow include: there is no shadow here.
      expect(effect._fragmentSourceCode).not.toContain("computeShadowWithCSM");
    } finally {
      clipmap.dispose();
      atmosphere.dispose();
      scene.dispose();
      engine.dispose();
    }
  }, timeLimit(60_000));

  it("reads Babylon's rule the define rests on (a canary on the installed engine)", () => {
    const src = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Engines/webgpuEngine.pure.js"), "utf8");
    expect(src).toContain("const disableUniformityAnalysisInFragment = fragmentCode.indexOf(`#define DISABLE_UNIFORMITY_ANALYSIS`) >= 0;");
    // And the include that gave high and medium the define by accident.
    const shadows = readFileSync(createRequire(import.meta.url).resolve("@babylonjs/core/Shaders/ShadersInclude/shadowsFragmentFunctions.js"), "utf8");
    expect(shadows).toContain("#define DISABLE_UNIFORMITY_ANALYSIS");
  });
});
