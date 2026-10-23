import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// As in `renderer.test.ts`: the ground's texture arrays, whose real loader
// fetches and decodes the layer images, and `createRenderer`'s WebGL
// `Engine`, stand-ins at the module boundary, so whole renderers build here.
vi.mock("../../src/game/groundMaps.js", () => ({
  reportLayer: () => undefined,
  loadGroundArrays: () => ({
    normals: { isReady: () => true, dispose() {} },
    rah: { isReady: () => true, dispose() {}, getSize: () => ({ width: 1, height: 1 }) },
    ready: Promise.resolve(),
    dispose() {},
  }),
}));
vi.mock("@babylonjs/core/Engines/engine.js", async () => {
  const mod = await vi.importActual<typeof import("@babylonjs/core/Engines/nullEngine.js")>("@babylonjs/core/Engines/nullEngine.js");
  return { Engine: mod.NullEngine };
});

// The post chain is built where the engine renders to float textures, which
// NullEngine says it cannot; here it is, so its post-processes are readied
// below and import their shaders.
vi.mock("../../src/game/post.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/game/post.js")>();
  return { ...mod, fxSupportedBy: () => true };
});

import "../../src/sim/passes/index.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import { createRenderer } from "../../src/game/renderer.js";
import type { QualityTier } from "../../src/game/quality.js";
import {
  WEBGL2_SHADER_MODULES,
  forgetWebGl2Shaders,
  loadWebGl2Shaders,
  pageIdle,
  prefetchWebGl2Shaders,
} from "../../src/game/webgl2Shaders.js";
import { createForest } from "../../src/sim/forest.js";
import type { Level } from "../../src/sim/level.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { skyFixture } from "./helpers/skyFixture.js";

const require = createRequire(import.meta.url);
const SOURCE = fileURLToPath(new URL("../../src/game/webgl2Shaders.ts", import.meta.url));
const BABYLON_SHADERS = dirname(require.resolve("@babylonjs/core/Shaders/pbr.vertex.js"));
const LEVEL: Level = { id: "webgl2-shaders", brushes: [], playerSpawns: [], enemySpawns: [] };
const TIERS: readonly QualityTier[] = ["low", "medium", "high"];
const CANVAS = { renderWidth: 1600, renderHeight: 900 } as unknown as HTMLCanvasElement;

/** The shader names the module at `spec` registers as it loads, with every
 * module it imports statically: a shader module imports its includes so, and
 * the build's chunk graph fetches them with it. */
function registeredBy(spec: string, names = new Set<string>(), seen = new Set<string>()): Set<string> {
  const file = spec.startsWith("@") ? require.resolve(spec) : spec;
  if (seen.has(file)) return names;
  seen.add(file);
  // Only the shader modules register a shader; `dumpTools` and the store do not.
  if (!file.startsWith(BABYLON_SHADERS)) return names;
  const text = readFileSync(file, "utf8");
  const name = /^const name = "([^"]+)";$/m.exec(text)?.[1];
  if (name !== undefined) names.add(name);
  for (const m of text.matchAll(/^import .*?from "(\.[^"]+)";$/gm)) registeredBy(resolve(dirname(file), m[1] as string), names, seen);
  return names;
}

/** The Babylon module that registers the shader `name`, as a specifier, or
 * null where Babylon ships none of that name (the game's own shaders). */
function moduleOf(name: string, kind: "shader" | "include"): string | null {
  const relative =
    kind === "include"
      ? `ShadersInclude/${name}.js`
      : name.endsWith("VertexShader")
        ? `${name.slice(0, -"VertexShader".length)}.vertex.js`
        : name.endsWith("PixelShader")
          ? `${name.slice(0, -"PixelShader".length)}.fragment.js`
          : null;
  if (relative === null || !existsSync(join(BABYLON_SHADERS, relative))) return null;
  return `@babylonjs/core/Shaders/${relative}`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Readies everything of `scene` that loads shaders as it is readied: each
 * material on a probe box of its own (`probes`), each shadow generator with
 * the probe as its caster, each camera's post-processes, the particle
 * systems and the depth renderers; then a frame. */
function readyEverything(scene: Scene, probes: Map<Material, Mesh>): void {
  // A texture is never ready under NullEngine (nothing uploads it); told not
  // to block, as one still loading is in play, a material readies without it.
  for (const texture of scene.textures) (texture as { isBlocking: boolean }).isBlocking = false;
  for (const material of [...scene.materials]) {
    let probe = probes.get(material);
    if (probe === undefined) {
      probe = MeshBuilder.CreateBox(`probe_${probes.size}`, { size: 1 }, scene);
      probe.material = material;
      probes.set(material, probe);
    }
    for (const sub of probe.subMeshes ?? []) {
      material.isReadyForSubMesh(probe, sub, false);
      for (const light of scene.lights) {
        for (const generator of Object.values(light.getShadowGenerators() ?? {})) generator.isReady(sub, false, false);
      }
      for (const depth of Object.values((scene as unknown as { _depthRenderer?: Record<string, { isReady(sub: unknown, instances: boolean): boolean }> })._depthRenderer ?? {})) {
        depth.isReady(sub, false);
      }
    }
  }
  for (const camera of scene.cameras) {
    for (const post of (camera as unknown as { _postProcesses: (PostProcess | null)[] })._postProcesses) post?.isReady();
  }
  for (const particles of scene.particleSystems) particles.isReady();
  for (const target of scene.customRenderTargets) target.isReadyForRendering();
  scene.render();
}

describe("the WebGL2 shaders fetched ahead on a WebGPU page", () => {
  afterEach(() => {
    forgetWebGl2Shaders();
    vi.restoreAllMocks();
  });

  // First in the file: the test after it imports every module listed, which
  // registers its shaders in the same store this one reads.
  it("name every GLSL shader module the WebGL2 renderer loads lazily, at every tier", async () => {
    // Registered as the game's modules loaded: in the bundle already, and the
    // game's own; what the renderers below add is what Babylon fetched.
    const before = { shaders: new Set(Object.keys(ShaderStore.ShadersStore)), includes: new Set(Object.keys(ShaderStore.IncludesShadersStore)) };
    for (const tier of TIERS) {
      const renderer = createRenderer(CANVAS, LEVEL, createForest(388817), { tier, skyTable: skyFixture() });
      try {
        // Each material, shadow generator, post-process and particle system
        // imports its shaders as it is first readied, over a few turns. A
        // scene built under Node has none of its models (their files are not
        // fetched here) and little in view, so each is readied by hand, on a
        // probe box where it needs a mesh, until a while brings nothing new.
        const probes = new Map<Material, Mesh>();
        let quiet = 0;
        let seen = -1;
        for (let i = 0; i < 200 && quiet < 15; i++) {
          readyEverything(renderer.scene, probes);
          await sleep(20);
          const count = Object.keys(ShaderStore.ShadersStore).length + Object.keys(ShaderStore.IncludesShadersStore).length;
          quiet = count === seen ? quiet + 1 : 0;
          seen = count;
        }
      } finally {
        renderer.dispose();
      }
    }
    const needed = new Set<string>();
    for (const name of Object.keys(ShaderStore.ShadersStore)) {
      const spec = before.shaders.has(name) ? null : moduleOf(name, "shader");
      if (spec !== null) needed.add(spec);
    }
    for (const name of Object.keys(ShaderStore.IncludesShadersStore)) {
      const spec = before.includes.has(name) ? null : moduleOf(name, "include");
      if (spec !== null) needed.add(spec);
    }
    expect(needed.size).toBeGreaterThan(0);
    const provided = new Set<string>();
    for (const spec of Object.keys(WEBGL2_SHADER_MODULES)) for (const name of registeredBy(spec)) provided.add(name);
    const missing = [...needed].filter((spec) => {
      const name = [...registeredBy(spec)][0];
      return name === undefined || !provided.has(name);
    });
    // The includes a listed module imports statically come with it; a module
    // missing here is one to add to `WEBGL2_SHADER_MODULES`.
    expect(missing, `modules the WebGL2 renderer loads lazily and no listed module brings:\n  ${missing.join("\n  ")}`).toEqual([]);
  }, timeLimit(120_000));

  it("name the sun's shadow shaders, which NullEngine cannot draw and so never loads", () => {
    // The lighting makes a cascaded shadow generator on every tier with a
    // shadow map, which imports its shaders in the engine's language as it is
    // made; NullEngine draws no shadow map, so the renderers above make none.
    const lighting = readFileSync(fileURLToPath(new URL("../../src/game/lighting.ts", import.meta.url)), "utf8");
    expect(lighting).toContain("new CascadedShadowGenerator(");
    const generator = readFileSync(require.resolve("@babylonjs/core/Lights/Shadows/shadowGenerator.js"), "utf8");
    const glsl = [...generator.matchAll(/import\("\.\.\/\.\.\/(Shaders\/[^"]+)"\)/g)].map((m) => `@babylonjs/core/${m[1]}`);
    expect(glsl).toContain("@babylonjs/core/Shaders/shadowMap.fragment.js");
    const provided = new Set<string>();
    for (const spec of Object.keys(WEBGL2_SHADER_MODULES)) for (const name of registeredBy(spec)) provided.add(name);
    const missing = glsl.filter((spec) => ![...registeredBy(spec)].every((name) => provided.has(name)));
    expect(missing).toEqual([]);
  });

  it("lists each module under the specifier it imports, once", () => {
    const text = readFileSync(SOURCE, "utf8");
    const entries = [...text.matchAll(/^\s*"([^"]+)": \(\) => import\("([^"]+)"\),$/gm)].map((m) => [m[1], m[2]]);
    expect(entries.length).toBe(Object.keys(WEBGL2_SHADER_MODULES).length);
    for (const [key, spec] of entries) expect(key).toBe(spec);
    expect(new Set(entries.map(([key]) => key)).size).toBe(entries.length);
  });

  it("loads every module listed, once for the page, and names none as failed", async () => {
    const first = loadWebGl2Shaders();
    expect(loadWebGl2Shaders()).toBe(first);
    expect(await first).toEqual({ failed: [] });
    for (const spec of Object.keys(WEBGL2_SHADER_MODULES)) for (const name of registeredBy(spec)) {
      expect(name in ShaderStore.ShadersStore || name in ShaderStore.IncludesShadersStore, name).toBe(true);
    }
  });

  it("loads each module on its own, names the ones that failed, and loads the page's again after a failure", async () => {
    const got = await loadWebGl2Shaders({
      a: () => Promise.resolve(),
      b: () => Promise.reject(new Error("Failed to fetch dynamically imported module")),
      c: () => Promise.resolve(),
    });
    expect(got).toEqual({ failed: ["b"] });
    // A load failed in part is not kept: the next call loads again.
    const firstEntry = Object.keys(WEBGL2_SHADER_MODULES)[0] as string;
    const once = { ...WEBGL2_SHADER_MODULES, [firstEntry]: () => Promise.reject(new Error("offline")) };
    const failing = loadWebGl2Shaders(once);
    expect(await failing).toEqual({ failed: [firstEntry] });
    expect(loadWebGl2Shaders(once)).not.toBe(failing);
  });

  it("fetches ahead at idle, once, and says what could not be fetched; cancelled first, never", async () => {
    const scheduled: (() => void)[] = [];
    let cancelled = 0;
    const idle = (fn: () => void): (() => void) => {
      scheduled.push(fn);
      return () => {
        cancelled += 1;
      };
    };
    const lines: string[] = [];
    let loads = 0;
    const stop = prefetchWebGl2Shaders({ idle, load: () => (loads++, Promise.resolve({ failed: [] })), log: (line) => lines.push(line) });
    expect(loads).toBe(0);
    scheduled[0]!();
    await Promise.resolve();
    expect(loads).toBe(1);
    expect(lines).toEqual([]);
    stop();
    expect(cancelled).toBe(1);

    prefetchWebGl2Shaders({ idle, load: () => Promise.resolve({ failed: ["@babylonjs/core/Shaders/shadowMap.fragment.js"] }), log: (line) => lines.push(line) });
    scheduled[1]!();
    await Promise.resolve();
    await Promise.resolve();
    expect(lines).toEqual(["WebGL2: 1 of the shaders fetched ahead for a fall back could not be fetched: @babylonjs/core/Shaders/shadowMap.fragment.js"]);

    const late = prefetchWebGl2Shaders({ idle, load: () => Promise.resolve({ failed: ["x"] }), log: (line) => lines.push(line) });
    late();
    scheduled[2]!();
    await Promise.resolve();
    await Promise.resolve();
    expect(lines.length).toBe(1);
  });

  it("asks the browser for an idle moment where it offers one, and the next turn where it does not", async () => {
    const page = globalThis as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
    const had = { request: page.requestIdleCallback, cancel: page.cancelIdleCallback };
    const asked: (() => void)[] = [];
    const cancelledIds: number[] = [];
    page.requestIdleCallback = (fn: () => void) => (asked.push(fn), 7);
    page.cancelIdleCallback = (id: number) => void cancelledIds.push(id);
    try {
      let ran = 0;
      const stop = pageIdle(() => ran++);
      expect(asked.length).toBe(1);
      asked[0]!();
      expect(ran).toBe(1);
      stop();
      expect(cancelledIds).toEqual([7]);
    } finally {
      page.requestIdleCallback = had.request;
      page.cancelIdleCallback = had.cancel;
    }
    delete page.requestIdleCallback;
    let ran = 0;
    pageIdle(() => ran++);
    expect(ran).toBe(0);
    await sleep(5);
    expect(ran).toBe(1);
    const stop = pageIdle(() => ran++);
    stop();
    await sleep(5);
    expect(ran).toBe(1);
    page.requestIdleCallback = had.request;
  });
});
