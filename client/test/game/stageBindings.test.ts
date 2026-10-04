import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// The ground arrays decode images node cannot: one-texel stand-ins, one
// binding each, as the arrays are.
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

import "../../src/sim/passes/index.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { QUALITY, type QualityTier } from "../../src/game/quality.js";
import { WEBGPU_REQUIRED_LIMITS } from "../../src/game/engineChoice.js";
import { createAtmosphere } from "../../src/game/atmosphere.js";
import { createLighting } from "../../src/game/lighting.js";
import { budgetLights, createHeadlamp, LIGHT_BUDGET } from "../../src/game/headlamp.js";
import { createClipmap } from "../../src/game/renderer.js";
import { createForestMeshes } from "../../src/game/forestMeshes.js";
import { seedFromToken } from "../../src/game/seed.js";
import { FOG_DISTANCE } from "../../src/sim/forestConstants.js";
import { MAX_PLAYERS } from "../../src/sim/constants.js";
import { drawnEffect, probeReady, stageBindings, webgpuProcessingEngine, type StageBindings } from "./helpers/webgpuProcessing.js";
import { timeLimit } from "../helpers/timeLimit.js";
import { skyFixture } from "./helpers/skyFixture.js";

/**
 * Three of WebGPU's per-stage limits sit exactly at their defaults in the
 * browser's sweep (the verification note, §4): sampled textures and samplers
 * per stage, 16 each, set by the terrain's fragment stage, and uniform buffers
 * per stage, 12, set by every lit PBR material with the seven lights the game
 * binds at most. The device asks for exactly the default of these
 * (`WEBGPU_REQUIRED_LIMITS`), so one more texture or sampler on the terrain,
 * or an eighth light, fails the pipeline on every adapter.
 *
 * What the suite can see of them: the terrain's clipmap and the forest, built
 * as the renderer builds them with every lamp of a full party lit, on a
 * `NullEngine` that lays out each stage's bindings as the WebGPU engine does
 * (`helpers/webgpuProcessing.ts`). The one binding it cannot make is the sun's
 * cascaded shadow map (no float render targets), so a mesh that receives
 * shadows gets its texture and its comparison sampler added by count, one each
 * per shadowed light, in the fragment stage (a canary below).
 */

/** What to do when a count below grows. */
const CEILING =
  "WebGPU's default is the ceiling for this limit: the device asks for no more. Ask for more in " +
  "`WEBGPU_REQUIRED_LIMITS` (engineChoice.ts), which then turns away every adapter that offers only the default, " +
  "or take a texture, a sampler or a light away";

/** The three limits the device is made with. */
const LIMITS = {
  textures: WEBGPU_REQUIRED_LIMITS.maxSampledTexturesPerShaderStage as number,
  samplers: WEBGPU_REQUIRED_LIMITS.maxSamplersPerShaderStage as number,
  uniformBuffers: WEBGPU_REQUIRED_LIMITS.maxUniformBuffersPerShaderStage as number,
};

type Drawn = { vertex: StageBindings; fragment: StageBindings; textureNames: string[]; bufferNames: string[]; receivesShadows: boolean };

/** The terrain and the forest as the renderer builds them, every lamp of a
 * full party in the scene. Keyed by material name; the first mesh that draws
 * a material speaks for it. */
async function buildWorld(): Promise<{ drawn: Map<string, Drawn>; lights: number; dispose(): void }> {
  const engine = webgpuProcessingEngine();
  const scene = new Scene(engine);
  const seed = seedFromToken("atmo");
  // The renderer's order: every material's light cap raised to the budget,
  // the atmosphere before any material, the camera, the local lamp, the
  // lighting (fog, sun, fill, probe), the terrain, the forest; the other
  // hikers' lamps as they join.
  budgetLights(scene);
  const atmosphere = createAtmosphere(scene, FOG_DISTANCE);
  scene.activeCamera = new UniversalCamera("player", new Vector3(0, 2, 0), scene);
  createHeadlamp(scene, "lamp_local");
  const lighting = createLighting(scene, { tier: "high", viewDistance: FOG_DISTANCE, colourPath: "post", sky: skyFixture() });
  const clipmap = createClipmap(scene, seed);
  for (const mesh of clipmap.meshes) lighting.addShadowMesh(mesh);
  const forest = createForestMeshes(scene, seed, { bakeImpostor: () => null });
  await forest.ready;
  forest.update(0, 0);
  for (const mesh of forest.casterMeshes) lighting.addShadowMesh(mesh);
  for (let player = 1; player < MAX_PLAYERS; player++) createHeadlamp(scene, `lamp_player_${player}`);
  probeReady(scene);

  const drawn = new Map<string, Drawn>();
  for (const mesh of scene.meshes as Mesh[]) {
    const material = mesh.material;
    if (!material || !mesh.subMeshes?.[0] || drawn.has(material.name) || !mesh.isEnabled()) continue;
    const effect = await drawnEffect(mesh);
    drawn.set(material.name, {
      ...stageBindings(effect),
      textureNames: Object.keys(effect._processingContext.availableTextures),
      bufferNames: Object.keys(effect._processingContext.availableBuffers),
      receivesShadows: mesh.receiveShadows,
    });
  }
  return {
    drawn,
    lights: scene.lights.length,
    dispose() {
      forest.dispose();
      clipmap.dispose();
      lighting.dispose();
      atmosphere.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

/** A stage's bindings on a tier, the shadow map's added where it is drawn. */
function onTier(drawn: Drawn, tier: QualityTier): { vertex: StageBindings; fragment: StageBindings } {
  const shadowed = drawn.receivesShadows && QUALITY[tier].shadowMapSize > 0 ? 1 : 0;
  return {
    vertex: drawn.vertex,
    fragment: {
      textures: drawn.fragment.textures + shadowed,
      samplers: drawn.fragment.samplers + shadowed,
      uniformBuffers: drawn.fragment.uniformBuffers,
    },
  };
}

describe("WebGPU's per-stage bindings, at the defaults the device keeps", () => {
  let world: Awaited<ReturnType<typeof buildWorld>>;

  beforeAll(async () => {
    world = await buildWorld();
  }, timeLimit(60_000));
  afterAll(() => world?.dispose());

  it("pins the textures the terrain's fragment stage samples", () => {
    expect(world.drawn.get("mat_terrain")?.textureNames, CEILING).toEqual([
      "reflectionSampler",
      "environmentBrdfSampler",
      "atmGradient",
      "terrainGrass",
      "terrainFloor",
      "terrainRock",
      "terrainSand",
      "terrainPebble",
      "terrainNormals",
      "terrainRAH",
      "roadCenter",
      "roadAsphalt",
      "trailIndex",
      "trailSegs",
      "featureTex",
    ]);
  });

  it("pins the lights a material binds: the sun, the fill and a full party's lamps", () => {
    expect([MAX_PLAYERS, LIGHT_BUDGET, world.lights], CEILING).toEqual([5, 7, 7]);
    expect(world.drawn.get("mat_terrain")?.bufferNames, CEILING).toEqual([
      "Internals",
      "Material",
      "Scene",
      "Mesh",
      "Light0",
      "Light1",
      "Light2",
      "Light3",
      "Light4",
      "Light5",
      "Light6",
      "LeftOver",
    ]);
  });

  it("counts what the browser read for the terrain on both tiers: 16 textures, 16 samplers, 12 uniform buffers", () => {
    const terrain = world.drawn.get("mat_terrain") as Drawn;
    const measured = {
      vertex: { textures: 0, samplers: 0, uniformBuffers: 12 },
      fragment: { textures: 16, samplers: 16, uniformBuffers: 12 },
    };
    expect({ high: onTier(terrain, "high"), medium: onTier(terrain, "medium") }, CEILING).toEqual({ high: measured, medium: measured });
  });

  it("holds every material the terrain and the forest draw within the device's limits on every tier", () => {
    // The device asks for WebGPU's defaults of the three, no more.
    expect(LIMITS).toEqual({ textures: 16, samplers: 16, uniformBuffers: 12 });
    expect(world.drawn.size).toBe(21);
    for (const [name, drawn] of world.drawn) {
      for (const tier of Object.keys(QUALITY) as QualityTier[]) {
        const stages = onTier(drawn, tier);
        for (const [stage, seen] of Object.entries(stages)) {
          const at = `${name}, ${stage} stage, on ${tier}: ${CEILING}`;
          expect(seen.textures, at).toBeLessThanOrEqual(LIMITS.textures);
          expect(seen.samplers, at).toBeLessThanOrEqual(LIMITS.samplers);
          expect(seen.uniformBuffers, at).toBeLessThanOrEqual(LIMITS.uniformBuffers);
        }
      }
    }
  });

  it("reads Babylon's rules the count rests on (canaries on the installed engine and the lighting)", () => {
    const read = (spec: string): string => readFileSync(createRequire(import.meta.url).resolve(spec), "utf8");
    // A cascaded shadow map filtered by comparison is one texture and one
    // sampler per shadowed light, and the sun's is filtered so.
    const lightFragment = read("@babylonjs/core/Shaders/ShadersInclude/lightUboDeclaration.js");
    expect(lightFragment).toContain("#elif defined(SHADOWPCF{X})\nuniform highp sampler2DArrayShadow shadowTexture{X};\n");
    // And every texture a light's fragment declarations can bind, so one
    // added anywhere in the include, for shadows or otherwise, is seen.
    expect([...lightFragment.matchAll(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?\w*[sS]ampler\w*\s+[^;]+;/g)].map((m) => m[0])).toEqual([
      "uniform sampler2D iesLightTexture{X};",
      "uniform sampler2D rectAreaLightEmissionTexture{X};",
      "uniform sampler2D projectionLightTexture{X};",
      "uniform sampler2D lightDataTexture{X};",
      "uniform highp sampler2D tileMaskTexture{X};",
      "uniform highp sampler2DArrayShadow shadowTexture{X};",
      "uniform highp sampler2DArray depthTexture{X};",
      "uniform highp sampler2DArrayShadow shadowTexture{X};",
      "uniform highp sampler2DArray shadowTexture{X};",
      "uniform samplerCube shadowTexture{X};",
      "uniform highp sampler2DShadow shadowTexture{X};",
      "uniform highp sampler2D depthTexture{X};",
      "uniform highp sampler2DShadow shadowTexture{X};",
      "uniform sampler2D shadowTexture{X};",
    ]);
    const lighting = readFileSync(new URL("../../src/game/lighting.ts", import.meta.url), "utf8");
    expect(lighting).toContain("    shadows.usePercentageCloserFiltering = true;");
    expect(lighting).not.toMatch(/usePercentageCloserFilteringSoft|useContactHardeningShadow/);
  });
});
