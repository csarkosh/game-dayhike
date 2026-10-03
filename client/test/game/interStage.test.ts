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
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator.js";
import { WEBGPU_REQUIRED_LIMITS, WEBGPU_TEXTURE_FEATURES, featuresToRequest } from "../../src/game/engineChoice.js";
import { QUALITY, type QualityTier } from "../../src/game/quality.js";
import { createAtmosphere } from "../../src/game/atmosphere.js";
import { createLighting } from "../../src/game/lighting.js";
import { createHeadlamp } from "../../src/game/headlamp.js";
import { createForestMeshes } from "../../src/game/forestMeshes.js";
import { createWater } from "../../src/game/renderer.js";
import type { WaterPlugin } from "../../src/game/waterPlugin.js";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { seedFromToken } from "../../src/game/seed.js";
import { FOG_DISTANCE } from "../../src/sim/forestConstants.js";
import { pluginsInStates } from "./helpers/pluginText.js";
import { drawnEffect, probeReady, stageBindings, webgpuProcessingEngine, type ProcessedEffect } from "./helpers/webgpuProcessing.js";
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
 * caps of WebGPU's that shape a shader (`helpers/webgpuProcessing.ts`), the
 * derivatives the normal map's basis needs among them. What it
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
  "(the verification note, §4) and raise `maxInterStageShaderVariables` in engineChoice.ts " +
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
 * draws a material speaks for it, the forest's casters before the rest.
 *
 * A giant's material is drawn on its nearest mesh, a caster, which takes the
 * sun's shadows, and on its middle one, which takes none, so the caster is
 * the heavier of the two and the one to weigh. It speaks whether or not a
 * tree stands in it at this eye. 2026-09-29: the scene's order and its
 * enabled meshes did, until the trail on this world came within 53.5 m of
 * the origin where it had passed at 86.4 m: no giant pine stands in the
 * nearest mesh here now, where two did, and the middle mesh came first. */
async function buildForest(): Promise<{ drawn: Map<string, Drawn>; dispose(): void }> {
  // The WebGPU engine's caps that shape a shader: its derivatives make the
  // normal map's basis (`vTBN`) a varying.
  const engine = webgpuProcessingEngine();

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
  probeReady(scene);

  const drawn = new Map<string, Drawn>();
  const casters = new Set<unknown>(forest.casterMeshes);
  const meshes = scene.meshes as Mesh[];
  for (const mesh of [...meshes.filter((m) => casters.has(m)), ...meshes.filter((m) => !casters.has(m))]) {
    const material = mesh.material;
    if (!material || !mesh.subMeshes?.[0] || drawn.has(material.name) || !(casters.has(mesh) || mesh.isEnabled())) continue;
    const effect = await drawnEffect(mesh);
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

/** The cascades the sun's shadow generator draws on a tier: the tier's count,
 * held by Babylon's `numCascades` setter to between its least and most (a
 * canary below). */
function drawnCascades(tier: QualityTier): number {
  const { shadowMapSize, shadowCascades } = QUALITY[tier];
  if (shadowMapSize === 0) return 0;
  return Math.min(Math.max(shadowCascades, CascadedShadowGenerator.MIN_CASCADES_COUNT), CascadedShadowGenerator.MAX_CASCADES_COUNT);
}

/** The shadow varyings' locations on a mesh that receives shadows, on a tier:
 * per shadowed light, two per cascade and one more (`lightVxUboDeclaration`,
 * a canary below). */
function shadowLocations(tier: QualityTier, lights: number): number {
  const cascades = drawnCascades(tier);
  return cascades > 0 ? lights * (2 * cascades + 1) : 0;
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
      "foliage.REEDS": 4,
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
      // The wet plugin adds uniforms and no varying.
      "tree.giant_fir.material0": giant(["Atmosphere", "Foliage", "GroundConform", "Wet"]),
      "tree.giant_fir.material1": giant(["Atmosphere", "Foliage", "DistanceFade", "GroundConform", "Wet"]),
      "tree.giant_pine.material0": giant(["Atmosphere", "Foliage", "GroundConform", "Wet"]),
      "tree.giant_pine.material1": giant(["Atmosphere", "Foliage", "DistanceFade", "GroundConform", "Wet"]),
    });
  });

  it("pins the lights that cast shadows, and the cascades each tier draws", () => {
    expect(shadowGenerators(), WEIGH).toEqual(["game/lighting.ts: CascadedShadowGenerator"]);
    const tiers = Object.keys(QUALITY) as QualityTier[];
    // The tiers' settings, and what Babylon draws of them: it raises a
    // cascaded shadow generator's count to at least two, so the medium
    // tier's one cascade is drawn as two.
    expect(Object.fromEntries(tiers.map((tier) => [tier, QUALITY[tier].shadowMapSize > 0 ? QUALITY[tier].shadowCascades : 0])), WEIGH).toEqual({
      low: 0,
      medium: 1,
      high: 2,
    });
    expect(Object.fromEntries(tiers.map((tier) => [tier, drawnCascades(tier)])), WEIGH).toEqual({ low: 0, medium: 2, high: 2 });
  });

  it("counts what the browser read for the giants on both tiers", () => {
    // The browser's sweep (the verification note, §4): 17 vertex outputs on
    // the giants' `material0` effects and 18 on `material1`'s, on both tiers.
    const count = (tier: QualityTier) =>
      Object.fromEntries(
        GIANTS.map((name) => {
          const drawn = forest.drawn.get(name) as Drawn;
          return [name, drawn.locations + (drawn.receivesShadows ? shadowLocations(tier, 1) : 0)];
        }),
      );
    const measured = {
      "tree.giant_fir.material0": 17,
      "tree.giant_fir.material1": 18,
      "tree.giant_pine.material0": 17,
      "tree.giant_pine.material1": 18,
    };
    expect({ high: count("high"), medium: count("medium") }, WEIGH).toEqual({ high: measured, medium: measured });
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
    // The WebGPU engine has the caps the NullEngine above is given.
    expect(webgpu).toContain("            standardDerivatives: true,");
    expect(webgpu).toContain("            textureLOD: true,");
    expect(webgpu).toContain("    get supportsUniformBuffers() {\n        return true;\n    }");
    // A cascaded shadow generator draws two to four cascades, whatever it is set to.
    expect([CascadedShadowGenerator.MIN_CASCADES_COUNT, CascadedShadowGenerator.MAX_CASCADES_COUNT]).toEqual([2, 4]);
    expect(read("@babylonjs/core/Lights/Shadows/cascadedShadowGenerator.pure.js")).toContain(
      "    set numCascades(value) {\n        value = Math.min(Math.max(value, CascadedShadowGenerator.MIN_CASCADES_COUNT), CascadedShadowGenerator.MAX_CASCADES_COUNT);",
    );
    // A cascaded shadow light's varyings: two per cascade, and one more.
    const lightVertex = read("@babylonjs/core/Shaders/ShadersInclude/lightVxUboDeclaration.js");
    expect(lightVertex).toContain(
      "varying vec4 vPositionFromLight{X}[SHADOWCSMNUM_CASCADES{X}];varying float vDepthMetric{X}[SHADOWCSMNUM_CASCADES{X}];varying vec4 vPositionFromCamera{X};",
    );
    // And every varying a light's vertex declarations make, so one added
    // anywhere in the include is seen.
    expect([...lightVertex.matchAll(/\bvarying\s+[^;]+;/g)].map((m) => m[0])).toEqual([
      "varying vec4 vPositionFromLight{X}[SHADOWCSMNUM_CASCADES{X}];",
      "varying float vDepthMetric{X}[SHADOWCSMNUM_CASCADES{X}];",
      "varying vec4 vPositionFromCamera{X};",
      "varying vec4 vPositionFromLight{X};",
      "varying float vDepthMetric{X};",
    ]);
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

/** What to do when a pin on the sea's material turns red. */
const WEIGH_SEA =
  "the varyings of the sea's water material changed: count them against `maxInterStageShaderVariables` " +
  "in engineChoice.ts, and read the effect's locations in a browser if the count grew";

describe("inter-stage variables of the sea's water material on WebGPU, its waves on", () => {
  const limit = WEBGPU_REQUIRED_LIMITS.maxInterStageShaderVariables as number;
  const seas = new Map<QualityTier, { effect: ProcessedEffect; ocean: boolean; receivesShadows: boolean }>();
  const disposers: (() => void)[] = [];

  // The renderer's order on each tier: the atmosphere, the camera, the local
  // lamp, the lighting, then the water, at the coast so ring 0 holds sea.
  beforeAll(async () => {
    for (const tier of ["low", "medium", "high"] as const) {
      const engine = webgpuProcessingEngine();
      const scene = new Scene(engine);
      const atmosphere = createAtmosphere(scene, FOG_DISTANCE);
      scene.activeCamera = new UniversalCamera("player", new Vector3(-380, 3, 0), scene);
      createHeadlamp(scene, "lamp_local");
      const lighting = createLighting(scene, { tier, viewDistance: FOG_DISTANCE, colourPath: "post" });
      probeReady(scene);
      const water = createWater(scene, seedFromToken("atmo"), 0, [], tier, -380, 0);
      const mesh = water.meshes[0] as Mesh;
      const plugin = (mesh.material as PBRMaterial).pluginManager!.getPlugin("Water") as WaterPlugin;
      seas.set(tier, { effect: await drawnEffect(mesh), ocean: (plugin.ocean ?? null) !== null, receivesShadows: mesh.receiveShadows });
      disposers.push(() => {
        water.dispose();
        lighting.dispose();
        atmosphere.dispose();
        scene.dispose();
        engine.dispose();
      });
    }
  }, timeLimit(60_000));
  afterAll(() => {
    for (const dispose of disposers) dispose();
  });

  it("writes seven vertex outputs on the low tier and six on high and medium, and reads front_facing on the low tier alone: 8 and 6 of the 19", () => {
    for (const [tier, sea] of seas) {
      expect(sea.ocean, tier).toBe(true);
      // The water takes no shadows, so no light's shadow varyings join these.
      expect(sea.receivesShadows, tier).toBe(false);
      const varyings = [...sea.effect._vertexSourceCode.matchAll(/layout\(location = \d+\)\s*(?:flat\s+)?out (\w+) (\w+);/g)].map(
        ([, type, name]) => `${type} ${name}`,
      );
      // The bump's UV, on the low tier's sea alone: on high and medium the sea's
      // normal is its waves', and the material carries no bump.
      const bump = tier === "low";
      expect(varyings, `${tier}: ${WEIGH_SEA}`).toEqual([
        ...(bump ? ["vec2 vMainUV1"] : []),
        "vec3 vPositionW",
        "vec3 vNormalW",
        "vec3 vFogDistance",
        "float vBedDepth",
        "float vWaterViewDepth",
        "vec2 vOceanXZ",
      ]);
      expect(sea.effect._processingContext._varyingNextLocation, tier).toBe(bump ? 7 : 6);
      // The bump's tangent frame reads front_facing in the fragment stage, on the low tier alone.
      const frontFacing = sea.effect._fragmentSourceCode.includes("gl_FrontFacing");
      expect(frontFacing, tier).toBe(bump);
      expect(sea.effect._processingContext._varyingNextLocation + (frontFacing ? 1 : 0), `${tier}: ${WEIGH_SEA}`).toBe(bump ? 8 : 6);
      expect(bump ? 8 : 6).toBeLessThanOrEqual(limit);
    }
  });

  it("binds the waves' textures within a stage's 16: two in the vertex stage, ten in the fragment stage on low, nine without the bump", () => {
    for (const [tier, sea] of seas) {
      const { vertex, fragment } = stageBindings(sea.effect);
      const textures = tier === "low" ? 10 : 9;
      expect({ vertex: [vertex.textures, vertex.samplers], fragment: [fragment.textures, fragment.samplers] }, tier).toEqual({
        vertex: [2, 2],
        fragment: [textures, textures],
      });
      expect(fragment.textures).toBeLessThanOrEqual(WEBGPU_REQUIRED_LIMITS.maxSampledTexturesPerShaderStage as number);
    }
  });
});
