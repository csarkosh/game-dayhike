/**
 * The rain's cover map on Babylon Lite: what the rain has to fall through,
 * seen from above, from what the game draws it with (`rainCover.ts`: the kinds and their texels,
 * the clear colour, the camera, where the map stands; `rainParams.ts`: its
 * size and its step).
 *
 * - **A pass of the hike's own frame, drawn before it on the frames that
 *   want it.** The map is a render task of the scene with a target and a
 *   camera of its own and a list of its own: only registered meshes are in
 *   it, each drawn again with the material of its kind in place of its own.
 *   A registered mesh is the scene's mesh, so its geometry, its instance
 *   list and, for the terrain, its plugin vertex data are the buffers the
 *   hike's own draw reads: nothing is held twice. A frame that does not
 *   draw the map skips the pass whole, its uniforms with it.
 * - **Drawn only where it is read.** The map follows the player by the
 *   game's step rule whatever the weather, but it is drawn only on a frame
 *   that reads it (`update`'s `read`: a streak, a drip or a splash is
 *   shown), once for the place it then stands at.
 * - **A texel is the height shader's**: the top surface's world height, its
 *   transmission and its ceiling's lift, written in place of the lit colour
 *   by a plugin on a plain material, last in its fragment. The terrain's
 *   reads the canopy's density from the terrain's own vertex data
 *   (`TERRAIN_VERTEX_LAYOUT`); water is open, the rain landing on its
 *   surface; anything else is hard cover. A mesh whose vertices are placed
 *   by its own material's vertex stage (the sea's lattice, the parts of a
 *   car a pose turns) is registered with the plugin that places them, which
 *   the map's material of its kind then wears for it. A mesh the view does not hold is hidden, which
 *   leaves it out of this pass too, so the map has its own word on a mesh
 *   that the two see differently (`show`): a lake's surface or the sea is
 *   drawn here while it reaches into the map's square, whatever the view
 *   holds (`lakeMeshes.ts`, `seaMeshes.ts`).
 * - **The picture is laid as the game's**: its columns along the world's x
 *   and its rows along z from the low side, so a reader finds a place's
 *   texel as the game's shaders do. The camera looks straight down with z
 *   up the view, and its volume is turned over top for bottom to lay the
 *   rows that way; so neither face of a triangle is culled.
 *
 * Nothing on the low tier: its streaks fall through everything.
 */
import {
  addMeshToTask, addTaskAtStart, addToScene, createBankedFreeCamera, createMeshFromData, createPbrMaterial, createRenderTargetTexture, createRenderTask,
  disposeMeshGpu, enableOrthographicCamera, isRenderTaskHeld, removeFromScene, removeMeshFromTask, setMeshVisible, setTaskMeshVisible, setThinInstances, vec3,
  type EngineContext, type MaterialPlugin, type Mesh, type PbrMaterialProps, type SceneContext, type Texture2D,
} from "@babylonjs/lite";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import { RAIN_MAP_CAMERA, RAIN_MAP_CLEAR, createRainMapPlace, type RainMapKind } from "@csarkosh/engine/game/rainCover";
import { RAIN_MAP, type Vec3 } from "@csarkosh/engine/game/rainParams";
import { wgslFloat } from "./forestPlugins.js";
import { TERRAIN_VERTEX_FLOATS, TERRAIN_VERTEX_LAYOUT } from "./terrainPlugins.js";
import terrainSource from "../shaders/rainMap/terrain.wgsl?raw";
import hardSource from "../shaders/rainMap/hard.wgsl?raw";
import waterSource from "../shaders/rainMap/water.wgsl?raw";
import canopyVaryingSource from "../shaders/rainMap/canopyVarying.wgsl?raw";
import { fill, wgsl } from "@csarkosh/engine/game/shaders/shaderText";

const f = wgslFloat;

/** The canopy's density among the terrain's vertex data: the second weight set's last float (`terrainVertices.ts`). */
const CANOPY = TERRAIN_VERTEX_LAYOUT.find((part) => part.varying === "vTerrainW2") as (typeof TERRAIN_VERTEX_LAYOUT)[number];

/** The texel in place of the lit colour, by kind: the height shader's fragment (`RAIN_HEIGHT_FRAGMENT`, `rainMap.ts`). */
export const RAIN_MAP_WGSL = {
  terrain: fill(wgsl(terrainSource), { rainMapCanopyBlock: f(RAIN_MAP.canopyBlock), rainMapCanopyLift: f(RAIN_MAP.canopyLift) }),
  hard: wgsl(hardSource),
  water: wgsl(waterSource),
} as const;

/** The plugin that writes a kind's texel, last in the fragment. The terrain's declares the terrain's vertex data whole, as
 * the terrain's own plugin does, and hands the canopy's density on. */
export function rainMapPlugin(kind: RainMapKind): MaterialPlugin {
  if (kind !== "terrain") {
    return {
      name: kind === "hard" ? "RainMapHard" : "RainMapWater", priority: 990,
      getCustomCode: (stage) => (stage === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: RAIN_MAP_WGSL[kind] } : null),
    };
  }
  return {
    name: "RainMapTerrain",
    priority: 990,
    getCustomCode: (stage) =>
      stage === "fragment" ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: RAIN_MAP_WGSL.terrain } : { CUSTOM_VERTEX_MAIN_END: fill(wgsl(canopyVaryingSource), { canopyName: CANOPY.name }) },
    getVertexAttributes: () => [{ name: CANOPY.name, type: "vec4<f32>", format: "float32x4", stride: TERRAIN_VERTEX_FLOATS * 4, offset: CANOPY.offset * 4 }],
    getVaryings: () => [{ name: "vRainCanopy", type: "f32" }],
  };
}

/** The map as a shell that draws cover is handed it: every mesh added is of one kind, and is taken out before it is let go. */
export type CoverRegistry = {
  add(mesh: Mesh): void;
  remove(mesh: Mesh): void;
  /** The map's own word on whether it draws `mesh`, whatever the frame's own pass shows of it: for a mesh the two see differently. */
  show?(mesh: Mesh, shown: boolean): void;
};

/** The rings of the terrain in the map: the two finest cover its square (the finest alone is 128 m across). */
export const RAIN_MAP_RINGS = 2;

/** The map as it stands in a scene. */
export type LiteRainMap = {
  /** The map's picture: height, transmission and lift a texel. */
  readonly texture: Texture2D;
  /** The centre the map was last placed at (NaN before the first `update`). */
  readonly centre: Readonly<Vec3>;
  /** `place`: the plugin that places the mesh's vertices, for a mesh whose own material's vertex stage does. */
  register(mesh: Mesh, kind: RainMapKind, place?: MaterialPlugin): void;
  unregister(mesh: Mesh): void;
  /** Whether the map draws a registered `mesh`, whatever the frame's own pass shows of it. */
  show(mesh: Mesh, shown: boolean): void;
  /**
   * Moves the map to `player` by the step rule, and draws it with the frame
   * if `read` says the frame reads it and it has moved, or been asked for
   * again, since it was last drawn. True on the frame that draws it.
   */
  update(player: Vec3, read: boolean): boolean;
  /** The next frame that reads the map draws it again where it stands, moved or not. */
  redraw(): void;
  /** Says the frame is drawn: the map's pass is not drawn again until an `update` asks, or until a frame draws it whole where this one drew nothing for a pipeline still compiling. */
  frameDrawn(): void;
  /** Meshes registered. */
  readonly meshes: number;
  /** Times the map was drawn. */
  readonly draws: number;
  /** Takes every mesh out of the map and its own out of the scene. The pass and its target go with the scene. */
  dispose(): void;
};

/** The cover map of `scene` on medium and high, made before the scene is registered; null on low. */
export function createLiteRainMap(engine: EngineContext, scene: SceneContext, tier: QualityTier): LiteRainMap | null {
  if (tier === "low") return null;
  // Half float, as the game's: a height in metres, and no filter between a roof and the ground.
  const target = createRenderTargetTexture(engine, {
    lbl: "rain_map", format: "rgba16float", dFormat: "depth24plus", samples: 1, size: { width: RAIN_MAP.texels, height: RAIN_MAP.texels },
  });
  const { half, near, far, height } = RAIN_MAP_CAMERA;
  // Straight down, z up the view, so the view's x is the world's x; the volume turned over, so the picture's first
  // row is the low z.
  const camera = createBankedFreeCamera(vec3(0, height, 0), vec3(0, 0, 0), vec3(0, 0, 1));
  camera.nearPlane = near;
  camera.farPlane = far;
  // The pass's own, never the scene's: it is in no scene, and the pass names it.
  enableOrthographicCamera(camera, { halfHeight: half, left: -half, right: half, bottom: half, top: -half });

  const material = (kind: RainMapKind, place?: MaterialPlugin): PbrMaterialProps => {
    const made = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 });
    made.doubleSided = true;
    made.plugins = place === undefined ? [rainMapPlugin(kind)] : [rainMapPlugin(kind), place];
    return made;
  };
  const materials = { terrain: material("terrain"), hard: material("hard"), water: material("water") };
  // Lite builds a mesh drawn with another material by the scene's own build of that material's kind, made when the
  // scene is registered, and that build draws instance lists only if a mesh of the scene had one then. The cliffs'
  // buckets, which have, land long after. So one mesh that is never shown stands in the scene from the start with an
  // instance list of one: a triangle of no size.
  const seed = createMeshFromData(engine, "rain_map_seed", new Float32Array(9), new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]));
  seed.material = materials.hard;
  setThinInstances(seed, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), 1);
  setMeshVisible(seed, false);
  addToScene(scene, seed);
  const task = createRenderTask(
    {
      name: "rain_map", rt: target.rt, cam: camera, clr: true,
      clrColor: { r: RAIN_MAP_CLEAR.height, g: RAIN_MAP_CLEAR.transmission, b: RAIN_MAP_CLEAR.lift, a: 1 }, autoMirror: false,
      // The map is kept until it is drawn again: while a hike loads it draws whole or not at all (`drawWhole`), and a map
      // not drawn for a pipeline still compiling is asked for again (`frameDrawn`).
      drawWhole: true,
    },
    engine, scene,
  );
  task.enabled = false;
  // Before the hike's own pass, which reads the map in the same frame.
  addTaskAtStart(scene, task);

  const place = createRainMapPlace();
  const registered = new Set<Mesh>();
  /** The map is not drawn for where it stands: it has moved, or a redraw was asked for, since its last draw. */
  let due = false;
  let draws = 0;
  let disposed = false;

  return {
    texture: target.texture,
    centre: place.centre,
    get meshes() {
      return registered.size;
    },
    get draws() {
      return draws;
    },
    register(mesh, kind, place) {
      // A mesh is in the list once.
      if (disposed || registered.has(mesh)) return;
      registered.add(mesh);
      addMeshToTask(task, mesh, { material: place === undefined ? materials[kind] : material(kind, place) });
    },
    unregister(mesh) {
      if (disposed || !registered.delete(mesh)) return;
      removeMeshFromTask(task, mesh);
    },
    show(mesh, shown) {
      if (!disposed && registered.has(mesh)) setTaskMeshVisible(task, mesh, shown);
    },
    redraw() {
      place.redraw();
    },
    update(player, read) {
      if (place.update(player)) due = true;
      if (!due || !read) return false;
      due = false;
      const { centre } = place;
      camera.position.x = centre.x;
      camera.position.y = centre.y + height;
      camera.position.z = centre.z;
      camera.target.x = centre.x;
      camera.target.y = centre.y;
      camera.target.z = centre.z;
      task.enabled = true;
      draws++;
      return true;
    },
    frameDrawn() {
      // A frame that drew nothing of the map, a pipeline of it still compiling, leaves it owed.
      if (task.enabled && isRenderTaskHeld(task)) due = true;
      task.enabled = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of registered) removeMeshFromTask(task, mesh);
      registered.clear();
      // The pass stays the scene's, closed: the scene lets it go with its target, as it does every task of its own.
      task.enabled = false;
      removeFromScene(scene, seed);
      disposeMeshGpu(seed);
    },
  };
}
