import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";

// The forest's GLBs, read from disk: the forest asks the loader for URLs.
vi.mock("@babylonjs/core/Loading/sceneLoader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@babylonjs/core/Loading/sceneLoader.js")>();
  return {
    ...actual,
    loadAssetContainerAsync: async (url: unknown, scene: import("@babylonjs/core/scene.js").Scene) => {
      const name = String(url).split("/").pop()!.split("?")[0]!;
      const bytes = readFileSync(new URL(`../../assets/models/${name}`, import.meta.url));
      return await actual.loadAssetContainerAsync(new Uint8Array(bytes), scene, { pluginExtension: ".glb" });
    },
  };
});

// The terrain variants the lighting's sky reads.
import "../../src/sim/passes/index.js";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { WebGPUShaderProcessorGLSL } from "@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsGLSL.js";
import { WebGPUShaderProcessingContext } from "@babylonjs/core/Engines/WebGPU/webgpuShaderProcessingContext.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { WEBGPU_REQUIRED_LIMITS, WEBGPU_TEXTURE_FEATURES, featuresToRequest } from "../../src/game/engineChoice.js";
import { QUALITY, type QualityTier } from "../../src/game/quality.js";
import { createAtmosphere } from "../../src/game/atmosphere.js";
import { createLighting } from "../../src/game/lighting.js";
import { createHeadlamp } from "../../src/game/headlamp.js";
import { createForestMeshes } from "../../src/game/forestMeshes.js";
import { seedFromToken } from "../../src/game/seed.js";
import { FOG_DISTANCE } from "../../src/sim/forestConstants.js";
import { pluginsInStates } from "./helpers/pluginText.js";
import { timeLimit } from "../helpers/timeLimit.js";

/**
 * The WebGPU limit on inter-stage variables, held the way the specification
 * counts it ("validating inter-stage interfaces", WebGPU): a vertex stage may
 * write at most `maxInterStageShaderVariables` user-defined outputs, each at a
 * location below it; a fragment stage may read at most that many user-defined
 * inputs, less one for each inter-stage built-in it reads (`front_facing`,
 * `sample_index`, `sample_mask`, `primitive_index`, `subgroup_invocation_id`,
 * `subgroup_size`). The position built-in does not count.
 *
 * The suite cannot translate a shader to WGSL (the translators run only in a
 * browser), but it can run Babylon's own WebGPU GLSL processing on
 * `NullEngine`: the forest is built here as the renderer builds it, from the
 * shipped GLBs, with the same plugins, lights, fog and probe, and each
 * material's vertex outputs are read from the processed shader with the
 * locations Babylon gave them (a `mat3` takes three). `NullEngine` reports the
 * derivatives WebGPU always has, which the normal map's basis needs. What it
 * cannot make is the sun's cascaded shadow map (it has no float render
 * targets), so the shadow varyings are added by count: each cascade a
 * `vPositionFromLight` and a `vDepthMetric`, and one `vPositionFromCamera` per
 * shadowed light, on the meshes that receive shadows. Two rules of Babylon's
 * make the fragment count the vertex count: on WebGPU its GLSL processor
 * declares every vertex output in the fragment stage too (`_missingVaryings`),
 * and a two-sided PBR material reads `gl_FrontFacing`. Each rule is a canary
 * below.
 */

/** What to do when a pin below turns red. */
const WEIGH =
  "the varyings of a tree's material changed: read the locations of the effects in a browser " +
  "(the verification note, §6.1) and raise `maxInterStageShaderVariables` in engineChoice.ts " +
  "in the same commit if the count grew";

/** Locations a GLSL type takes, as Babylon's WebGPU processing context counts them. */
const LOCATIONS: Readonly<Record<string, number>> = { mat2: 2, mat3: 3, mat4: 4 };

/** The locations of the varyings a plugin injects into the vertex stage, by name. */
function injectedVaryings(code: Record<string, string> | null): Map<string, number> {
  const found = new Map<string, number>();
  for (const text of Object.values(code ?? {})) {
    for (const m of text.matchAll(/\bvarying\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)\s*(?:\[\s*(\d+)\s*\])?\s*;/g)) {
      const [, type, name, length] = m as unknown as [string, string, string, string | undefined];
      found.set(name, (LOCATIONS[type] ?? 1) * (length === undefined ? 1 : Number(length)));
    }
  }
  return found;
}

/** Each plugin's own varyings, in every state it is drawn in: the locations
 * they take, and their names. */
function pluginVaryings(): { locations: Record<string, number>; names: Set<string> } {
  const built = pluginsInStates();
  try {
    const locations: Record<string, number> = {};
    const names = new Set<string>();
    for (const { name, plugin, states } of built.cases) {
      const all = new Map<string, number>();
      for (const enter of states) {
        enter();
        for (const [varying, size] of injectedVaryings(plugin.getCustomCode("vertex"))) all.set(varying, size);
      }
      for (const varying of all.keys()) names.add(varying);
      locations[name] = [...all.values()].reduce((sum, n) => sum + n, 0);
    }
    return { locations, names };
  } finally {
    built.dispose();
  }
}

/** One of the forest's materials as drawn on one mesh, read after Babylon's
 * WebGPU processing. */
type Drawn = {
  /** `vName` or `vName (3)` for a varying that takes more than one location. */
  varyings: string[];
  /** Babylon's `_varyingNextLocation`: every location the vertex stage writes. */
  locations: number;
  frontFacing: boolean;
  receivesShadows: boolean;
  mesh: Mesh;
  material: Material;
};

/** The forest, as the renderer builds it, on a `NullEngine` that processes
 * GLSL as the WebGPU engine does. Keyed by material name; the first mesh that
 * draws a material speaks for it. */
async function buildForest(): Promise<{ drawn: Map<string, Drawn>; dispose(): void }> {
  const engine = new NullEngine();
  const processing = engine as unknown as {
    _shaderProcessor: unknown;
    _getShaderProcessingContext: (language: number) => unknown;
  };
  processing._shaderProcessor = new WebGPUShaderProcessorGLSL();
  processing._getShaderProcessingContext = (language) => new WebGPUShaderProcessingContext(language, false);
  // The WebGPU engine's caps have it (a canary below); the normal map's basis
  // (`vTBN`) is made only when it is there.
  engine.getCaps().standardDerivatives = true;

  const scene = new Scene(engine);
  // The renderer's order: the atmosphere before any material, the camera, the
  // local lamp, the lighting (fog, sun, fill, probe), then the forest.
  const atmosphere = createAtmosphere(scene, FOG_DISTANCE);
  scene.activeCamera = new UniversalCamera("player", new Vector3(0, 2, 0), scene);
  createHeadlamp(scene, "lamp_local");
  const lighting = createLighting(scene, { tier: "high", viewDistance: FOG_DISTANCE, colourPath: "post" });
  const forest = createForestMeshes(scene, seedFromToken("atmo"), { bakeImpostor: () => null });
  await forest.ready;
  forest.update(0, 0);
  // The renderer registers the forest's casters with the lighting, which is
  // what makes them receive the sun's shadows.
  for (const mesh of forest.casterMeshes) lighting.addShadowMesh(mesh);
  // The probe's cube is ready once it first renders, which NullEngine never does.
  const probe = scene.environmentTexture as unknown as { isReady: () => boolean } | null;
  if (probe) probe.isReady = () => true;

  const drawn = new Map<string, Drawn>();
  for (const mesh of scene.meshes as Mesh[]) {
    const material = mesh.material;
    const subMesh = mesh.subMeshes?.[0];
    if (!material || !subMesh || drawn.has(material.name) || !mesh.isEnabled()) continue;
    // The effect compiles over a few ticks.
    let ready = material.isReadyForSubMesh(mesh, subMesh, true);
    for (let i = 0; i < 50 && !ready; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      ready = material.isReadyForSubMesh(mesh, subMesh, true);
    }
    if (!ready) throw new Error(`${material.name} never became ready on the NullEngine`);
    const effect = subMesh.effect as unknown as {
      _processingContext: { _varyingNextLocation: number };
      _vertexSourceCode: string;
      _fragmentSourceCode: string;
    };
    const varyings = [...effect._vertexSourceCode.matchAll(/layout\(location = \d+\)\s*(?:flat\s+)?out (\w+) (\w+);/g)].map(
      ([, type, name]) => ((LOCATIONS[type as string] ?? 1) > 1 ? `${name} (${LOCATIONS[type as string]})` : (name as string)),
    );
    drawn.set(material.name, {
      varyings,
      locations: effect._processingContext._varyingNextLocation,
      frontFacing: effect._fragmentSourceCode.includes("gl_FrontFacing"),
      receivesShadows: mesh.receiveShadows,
      mesh,
      material,
    });
  }
  return {
    drawn,
    dispose() {
      forest.dispose();
      lighting.dispose();
      atmosphere.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

/** The lights that cast shadows: every shadow generator the game makes. */
function shadowGenerators(): string[] {
  const root = new URL("../../src/", import.meta.url);
  const found: string[] = [];
  const walk = (dir: URL, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const url = new URL(name, dir);
      if (statSync(url).isDirectory()) walk(new URL(`${name}/`, dir), `${prefix}${name}/`);
      else if (name.endsWith(".ts")) {
        for (const m of readFileSync(url, "utf8").matchAll(/new (\w*ShadowGenerator)\(/g)) found.push(`${prefix}${name}: ${m[1]}`);
      }
    }
  };
  walk(root, "");
  return found;
}

/** The shadow varyings' locations on a mesh that receives shadows, on a tier:
 * per shadowed light, two per cascade and one more (`lightVxUboDeclaration`,
 * a canary below). */
function shadowLocations(tier: QualityTier, lights: number): number {
  const { shadowMapSize, shadowCascades } = QUALITY[tier];
  return shadowMapSize > 0 ? lights * (2 * shadowCascades + 1) : 0;
}

/** The giants' two materials, the most varyings the forest draws. */
const GIANTS = ["tree.giant_fir.material0", "tree.giant_fir.material1", "tree.giant_pine.material0", "tree.giant_pine.material1"];

describe("inter-stage variables on WebGPU", () => {
  const plugins = pluginVaryings();
  const limit = WEBGPU_REQUIRED_LIMITS.maxInterStageShaderVariables as number;
  let forest: Awaited<ReturnType<typeof buildForest>>;

  beforeAll(async () => {
    forest = await buildForest();
  }, timeLimit(60_000));
  afterAll(() => forest?.dispose());

  it("pins what each plugin adds, so a new varying is seen and weighed against the limit", () => {
    expect(plugins.locations, WEIGH).toEqual({
      atmosphere: 0,
      cliffTint: 1,
      distanceFade: 2,
      "foliage.BLADES": 4,
      "foliage.BUSH": 4,
      "foliage.DUFF": 4,
      "foliage.FLOWER": 4,
      "foliage.GRASS": 4,
      "foliage.MEADOW": 4,
      "foliage.TREE": 4,
      "foliage.UNDERSTORY": 4,
      foliageLight: 0,
      groundConform: 0,
      skin: 0,
      terrain: 3,
      wing: 0,
    });
  });

  it("pins the varyings Babylon gives the giants' materials, as built on NullEngine", () => {
    const babylon = Object.fromEntries(
      GIANTS.map((name) => [name, forest.drawn.get(name)?.varyings.filter((v) => !plugins.names.has(v.split(" ")[0] as string))]),
    );
    expect(babylon, WEIGH).toEqual({
      "tree.giant_fir.material0": ["vAlbedoUV", "vBumpUV", "vPositionW", "vNormalW", "vTBN (3)", "vFogDistance"],
      "tree.giant_fir.material1": ["vMainUV1", "vPositionW", "vNormalW", "vTBN (3)", "vFogDistance"],
      "tree.giant_pine.material0": ["vAlbedoUV", "vBumpUV", "vPositionW", "vNormalW", "vTBN (3)", "vFogDistance"],
      "tree.giant_pine.material1": ["vMainUV1", "vPositionW", "vNormalW", "vTBN (3)", "vFogDistance"],
    });
  });

  it("pins the giants' features that add varyings", () => {
    const slots = [
      "albedoTexture",
      "ambientTexture",
      "bumpTexture",
      "emissiveTexture",
      "lightmapTexture",
      "metallicTexture",
      "microSurfaceTexture",
      "opacityTexture",
      "reflectivityTexture",
    ];
    const features = Object.fromEntries(
      GIANTS.map((name) => {
        const drawn = forest.drawn.get(name) as Drawn;
        const material = drawn.material as unknown as Record<string, unknown> & {
          pluginManager?: { _plugins: { name: string }[] };
        };
        return [
          name,
          {
            // A second UV set or a vertex colour is another varying.
            vertexData: drawn.mesh.getVerticesDataKinds().filter((kind) => !/^world\d$/.test(kind)),
            // Each texture sampled on its own UV channel is another varying.
            textures: slots.filter((slot) => material[slot] != null),
            twoSided: drawn.frontFacing,
            receivesShadows: drawn.receivesShadows,
            plugins: (material.pluginManager?._plugins ?? []).map((plugin) => plugin.name),
          },
        ];
      }),
    );
    const babylon = ["PBRBRDF", "PBRClearCoat", "PBRIridescence", "PBRAnisotropic", "Sheen", "PBRSubSurface", "DetailMap"];
    const giant = (ours: string[]) => ({
      vertexData: ["position", "normal", "tangent", "uv", "fadeBands", "groundGrad"],
      textures: ["albedoTexture", "bumpTexture"],
      twoSided: true,
      receivesShadows: true,
      plugins: [...babylon, ...ours],
    });
    expect(features, WEIGH).toEqual({
      "tree.giant_fir.material0": giant(["Atmosphere", "Foliage", "GroundConform"]),
      "tree.giant_fir.material1": giant(["Atmosphere", "Foliage", "DistanceFade", "GroundConform"]),
      "tree.giant_pine.material0": giant(["Atmosphere", "Foliage", "GroundConform"]),
      "tree.giant_pine.material1": giant(["Atmosphere", "Foliage", "DistanceFade", "GroundConform"]),
    });
  });

  it("pins the lights that cast shadows, and their cascades on each tier", () => {
    expect(shadowGenerators(), WEIGH).toEqual(["game/lighting.ts: CascadedShadowGenerator"]);
    expect(
      Object.fromEntries((Object.keys(QUALITY) as QualityTier[]).map((tier) => [tier, QUALITY[tier].shadowMapSize > 0 ? QUALITY[tier].shadowCascades : 0])),
      WEIGH,
    ).toEqual({ low: 0, medium: 1, high: 2 });
  });

  it("counts what the browser read for the giants on the high tier", () => {
    // The verification note, §6.1: 17 locations on the giants' `material0`
    // effects and 18 on `material1`'s, on the high tier.
    const high = Object.fromEntries(
      GIANTS.map((name) => {
        const drawn = forest.drawn.get(name) as Drawn;
        return [name, drawn.locations + (drawn.receivesShadows ? shadowLocations("high", 1) : 0)];
      }),
    );
    expect(high, WEIGH).toEqual({
      "tree.giant_fir.material0": 17,
      "tree.giant_fir.material1": 18,
      "tree.giant_pine.material0": 17,
      "tree.giant_pine.material1": 18,
    });
  });

  it("holds every material the forest draws within the device's limit on every tier, counted as the specification counts", () => {
    const lights = shadowGenerators().length;
    // The billboards are left out: with no bake their buckets stay off. Their
    // material is a plain PBR one with the distance fade, well inside.
    expect([...forest.drawn.keys()].sort()).toEqual([
      "deadwood.snag.material0",
      "skyMaterial",
      "tree.conifer_a.material0",
      "tree.conifer_a.material0_lod2",
      "tree.conifer_a.material1",
      "tree.conifer_a.material1_lod2",
      "tree.conifer_b.material0",
      "tree.conifer_b.material0_lod2",
      "tree.conifer_b.material1",
      "tree.conifer_b.material1_lod2",
      "tree.giant_fir.material0",
      "tree.giant_fir.material0_lod2",
      "tree.giant_fir.material1",
      "tree.giant_fir.material1_lod2",
      "tree.giant_pine.material0",
      "tree.giant_pine.material0_lod2",
      "tree.giant_pine.material1",
      "tree.giant_pine.material1_lod2",
      "understory.fern.material0",
      "understory.shrub.material0",
    ]);
    for (const [name, drawn] of forest.drawn) {
      // The processed shader's outputs and Babylon's own count agree.
      const listed = drawn.varyings.reduce((sum, v) => sum + Number(/\((\d+)\)$/.exec(v)?.[1] ?? 1), 0);
      expect(listed, name).toBe(drawn.locations);
      for (const tier of Object.keys(QUALITY) as QualityTier[]) {
        const outputs = drawn.locations + (drawn.receivesShadows ? shadowLocations(tier, lights) : 0);
        const builtins = drawn.frontFacing ? 1 : 0;
        const at = `${name} on ${tier}: ${WEIGH}`;
        // The vertex stage: every output within the count, and the last location below the limit.
        expect(outputs, at).toBeLessThanOrEqual(limit);
        expect(outputs - 1, at).toBeLessThanOrEqual(limit - 1);
        // The fragment stage: Babylon declares every vertex output as an input,
        // and each inter-stage built-in it reads takes one more.
        expect(outputs + builtins, at).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("reads Babylon's rules the count rests on (canaries on the installed engine)", () => {
    const read = (spec: string): string => readFileSync(createRequire(import.meta.url).resolve(spec), "utf8");
    const glsl = read("@babylonjs/core/Engines/WebGPU/webgpuShaderProcessorsGLSL.js");
    // Every vertex output is declared in the fragment stage too.
    expect(glsl).toContain("        // inject the missing varying in the fragment shader\n        for (let i = 0; i < this._missingVaryings.length; ++i) {");
    // A matrix takes as many locations as it has columns.
    expect(read("@babylonjs/core/Engines/WebGPU/webgpuShaderProcessingContext.js")).toContain("    mat3: 3,\n    mat4: 4,");
    const webgpu = read("@babylonjs/core/Engines/webgpuEngine.pure.js");
    // The WebGPU engine has the derivatives the NullEngine above is given.
    expect(webgpu).toContain("            standardDerivatives: true,");
    // A cascaded shadow light's varyings: two per cascade, and one more.
    expect(read("@babylonjs/core/Shaders/ShadersInclude/lightVxUboDeclaration.js")).toContain(
      "varying vec4 vPositionFromLight{X}[SHADOWCSMNUM_CASCADES{X}];varying float vDepthMetric{X}[SHADOWCSMNUM_CASCADES{X}];varying vec4 vPositionFromCamera{X};",
    );
    // Babylon's own kernel blur (the halation's) sizes its varyings from the
    // device's limit, so it can never pass it.
    expect(webgpu).toContain("            maxVaryingVectors: this._deviceLimits.maxInterStageShaderVariables,");
    expect(read("@babylonjs/core/PostProcesses/thinBlurPostProcess.js")).toContain("const maxVaryingRows = this.options.engine.getCaps().maxVaryingVectors");
  });

  it("draws nothing that lowers the vertex stage's count further (point lists, clip distances)", () => {
    // `clip_distances` needs the `clip-distances` feature, and the device is
    // asked only for what `featuresToRequest` keeps, whatever the adapter has.
    expect(featuresToRequest(["clip-distances", ...WEBGPU_TEXTURE_FEATURES])).not.toContain("clip-distances");
    // A point list comes from a material's fill mode or `pointsCloud`; no
    // source sets either. The one file that names these is the limit's own
    // comment, which says the game uses neither.
    const root = new URL("../../src/", import.meta.url);
    const found: string[] = [];
    const walk = (dir: URL, prefix: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const url = new URL(name, dir);
        if (statSync(url).isDirectory()) walk(new URL(`${name}/`, dir), `${prefix}${name}/`);
        else if (/\.(ts|fx)$/.test(name) && /pointsCloud|fillMode|Point(?:List|Fill)|clip_distances|clip-distances/.test(readFileSync(url, "utf8"))) {
          found.push(`${prefix}${name}`);
        }
      }
    };
    walk(root, "");
    expect(found).toEqual(["game/engineChoice.ts"]);
    // And every material the forest draws fills triangles.
    for (const [name, drawn] of forest.drawn) expect(drawn.material.fillMode, name).toBe(0);
  });

  it("keeps the limit in one place", () => {
    const src = readFileSync(new URL("../../src/game/engineChoice.ts", import.meta.url), "utf8");
    expect(src.match(/maxInterStageShaderVariables: \d+/g)?.length).toBe(1);
  });
});
