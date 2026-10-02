/**
 * Every material plugin the game attaches, built on one `NullEngine` scene
 * through the same attach functions the world uses, so tests can read the GLSL
 * each one injects and bind each one as a draw would. `pluginTexts` is what
 * `webglIdentity.test.ts` pins; `pluginsInStates` is what
 * `pluginBindings.test.ts` binds.
 */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
// The terrain variants the road, trail and feature paint read.
import "../../../src/sim/passes/index.js";
import { seedFromToken } from "../../../src/game/seed.js";
import { createAtmosphere } from "../../../src/game/atmosphere.js";
import { WEATHER_PRESETS } from "../../../src/game/weather.js";
import { attachSkinShading } from "../../../src/game/skin.js";
import {
  attachTerrainTexture,
  enableFeaturePaint,
  enableRoadPaint,
  enableTrailPaint,
} from "../../../src/game/terrainTexture.js";
import { attachDistanceFade } from "../../../src/game/distanceFadePlugin.js";
import { attachFoliageLight } from "../../../src/game/foliageLightPlugin.js";
import { attachFoliage, FOLIAGE_PROFILES, type FoliageProfile } from "../../../src/game/foliagePlugin.js";
import { attachGroundConform } from "../../../src/game/groundConformPlugin.js";
import { attachWing } from "../../../src/game/wingPlugin.js";
import { attachCliffTint } from "../../../src/game/cliffTintPlugin.js";
import halationExtractFragment from "../../../src/game/shaders/halationExtract.fragment.fx?raw";
import gradeFragment from "../../../src/game/shaders/grade.fragment.fx?raw";
import finishFragment from "../../../src/game/shaders/finish.fragment.fx?raw";

/** One plugin, on its own material and mesh, with the states it is bound in. */
export type PluginCase = {
  /** `atmosphere`, `terrain`, `foliage.BLADES`, … */
  name: string;
  plugin: MaterialPluginBase;
  scene: Scene;
  engine: NullEngine;
  subMesh: SubMesh;
  /** Each puts the plugin into one state it is drawn in; called in order. */
  states: (() => void)[];
};

/** A stand-in for `loadGroundArrays`, whose real loader fetches and decodes
 * the ground's layer images (the `terrainTexture.test.ts` stub). */
function stubGroundArrays(scene: Scene) {
  const tex = (name: string) => {
    const t = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene);
    t.name = name;
    return t;
  };
  return { normals: tex("terrainNormals"), rah: tex("terrainRAH"), ready: Promise.resolve(), dispose() {} };
}

/** The world seed the pins are built for, as the gates use it. */
const SEED = seedFromToken("atmo");

/** Every plugin, built fresh, and a `dispose` that must be called: the
 * atmosphere keeps module state (its record and gradient) that only its own
 * `dispose` resets. The atmosphere is created first, as the renderer does: it
 * registers for every PBR material made after it. */
export function pluginsInStates(): { cases: PluginCase[]; dispose(): void } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new UniversalCamera("camera", new Vector3(0, 2, -10), scene);
  scene.activeCamera = camera;
  const atmosphere = createAtmosphere(scene, 4000);

  const cases: PluginCase[] = [];
  const add = (
    name: string,
    attach: (material: PBRMaterial) => void,
    pluginName: string,
    states: (() => void)[] = [() => undefined],
  ): PBRMaterial => {
    const material = new PBRMaterial(`mat_${name}`, scene);
    attach(material);
    const plugin = material.pluginManager?.getPlugin(pluginName) as MaterialPluginBase | undefined;
    if (!plugin) throw new Error(`${name}: the ${pluginName} plugin did not attach`);
    const mesh = MeshBuilder.CreateBox(`mesh_${name}`, { size: 1 }, scene);
    mesh.material = material;
    cases.push({ name, plugin, scene, engine, subMesh: mesh.subMeshes[0] as SubMesh, states });
    return material;
  };

  add("atmosphere", () => undefined, "Atmosphere", [
    // Before the first update: the effect is off and nothing has set a record.
    () => undefined,
    () => atmosphere.update(WEATHER_PRESETS.mist, 12),
  ]);
  add(
    "skin",
    (m) => {
      m.metallicTexture = RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene);
      attachSkinShading(m);
    },
    "SkinShading",
  );
  let terrain: PBRMaterial | null = null;
  terrain = add("terrain", (m) => attachTerrainTexture(scene, m, { groundArrays: stubGroundArrays }), "TerrainTexture", [
    () => undefined,
    () => {
      enableRoadPaint(scene, terrain as PBRMaterial, SEED);
      enableTrailPaint(scene, terrain as PBRMaterial, SEED);
      enableFeaturePaint(scene, terrain as PBRMaterial, SEED);
    },
  ]);
  // Forced, as the deadwood bucket does: a plain PBR material is not alpha
  // tested, and the fade attaches only to alpha-tested ones otherwise.
  add("distanceFade", (m) => attachDistanceFade(m, { force: true }), "DistanceFade");
  // On a foliage material, as the world attaches it.
  add(
    "foliageLight",
    (m) => {
      attachFoliage(m, FOLIAGE_PROFILES.TREE, 1);
      attachFoliageLight(m);
    },
    "FoliageLight",
  );
  for (const profile of Object.keys(FOLIAGE_PROFILES).sort()) {
    add(
      `foliage.${profile}`,
      (m) => attachFoliage(m, FOLIAGE_PROFILES[profile as keyof typeof FOLIAGE_PROFILES] as FoliageProfile, 1),
      "Foliage",
    );
  }
  add("groundConform", (m) => attachGroundConform(m), "GroundConform");
  add("wing", (m) => attachWing(m, 0.5, 20), "Wing");
  add("cliffTint", (m) => attachCliffTint(m), "CliffTint");
  return {
    cases,
    dispose() {
      atmosphere.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

/** A plugin's injected code for one stage: each injection point in sorted
 * order, its name on a line of its own and then its code, raw. */
function stageText(plugin: MaterialPluginBase, stage: "vertex" | "fragment"): string | null {
  const code = plugin.getCustomCode(stage);
  if (code === null) return null;
  return Object.keys(code)
    .sort()
    .map((point) => `${point}\n${code[point]}`)
    .join("\n");
}

/** JSON with object keys sorted, so the text depends on content alone. */
function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/**
 * The rest of what shapes each plugin's program, per plugin and per state it
 * is drawn in (`terrain.interface`, …): its uniforms (the UBO layout and the
 * GLSL declarations), its samplers, its attributes, and the defines its
 * `prepareDefines` sets, in that order, one state after another.
 */
export function pluginInterfaces(): Record<string, string> {
  const texts: Record<string, string> = {};
  const built = pluginsInStates();
  try {
    for (const { name, plugin, states, scene, subMesh } of built.cases) {
      const parts: string[] = [];
      for (const [index, enter] of states.entries()) {
        enter();
        const samplers: string[] = [];
        plugin.getSamplers(samplers);
        const attributes: string[] = [];
        plugin.getAttributes(attributes, scene, subMesh.getMesh());
        const defines: Record<string, unknown> = {};
        plugin.prepareDefines(defines as never, scene, subMesh.getMesh());
        parts.push(
          `state ${index}`,
          `uniforms ${sortedJson(plugin.getUniforms())}`,
          `samplers ${sortedJson(samplers)}`,
          `attributes ${sortedJson(attributes)}`,
          `defines ${sortedJson(defines)}`,
        );
      }
      texts[`${name}.interface`] = parts.join("\n");
    }
  } finally {
    built.dispose();
  }
  return texts;
}

/** Every plugin's GLSL per stage (`terrain.fragment`, `foliage.BLADES.vertex`,
 * …), and the three post shaders as stored (`post.grade`, …). */
export function pluginTexts(): Record<string, string> {
  const texts: Record<string, string> = {};
  const built = pluginsInStates();
  try {
    for (const { name, plugin } of built.cases) {
      for (const stage of ["vertex", "fragment"] as const) {
        const text = stageText(plugin, stage);
        if (text !== null) texts[`${name}.${stage}`] = text;
      }
    }
  } finally {
    built.dispose();
  }
  texts["post.halationExtract"] = halationExtractFragment;
  texts["post.grade"] = gradeFragment;
  texts["post.finish"] = finishFragment;
  return texts;
}
