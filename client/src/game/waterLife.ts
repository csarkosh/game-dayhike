/**
 * The lake's life on Babylon.js: the midges' one draw (`midgeSwarms.ts`) and
 * the dragonflies' cards (`dragonflies.ts`), handed each frame what the life
 * stepped. The life itself (the presence by the hour, the weather, the wind
 * and the dread, the swarms' table, the dragonflies' state machines, the
 * frogs' chorus and the sound of it all) is stepped with no engine
 * (`waterLifeScene.ts`); this module is where it meets Babylon's meshes.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";

import type { LakeSource } from "../sim/terrain.js";
import type { QualityTier } from "./quality.js";
import { createDragonflyMeshes } from "./dragonflies.js";
import { createMidgeSwarms } from "./midgeSwarms.js";
import type { WaterLifeSound } from "./waterLifeAudio.js";
import type { WaterLifeMade } from "./waterLifeField.js";
import { createWaterLifeScene, type WaterLifeDraws, type WaterLifeFrame } from "./waterLifeScene.js";

export { WATER_LIFE_DT_MAX, WATER_LIFE_EASE_S, WATER_LIFE_REACH, type WaterLifeFrame } from "./waterLifeScene.js";

/**
 * The midges' and the dragonflies' blended sort index: last in their group.
 * Their bounds sit at the origin, so a sort by distance would flip with the
 * camera's distance from there; and Babylon's default (`Number.MAX_VALUE`,
 * kept by the water's blended surface off the high path and by the mist
 * banks) is above the rain's (`Number.MAX_SAFE_INTEGER` and the two under
 * it), so no index both draws them after the water and before the rain.
 */
const ALPHA_INDEX = Number.POSITIVE_INFINITY;

export type WaterLife = {
  /** The midges' and the dragonflies', for the see-through group. */
  readonly meshes: readonly Mesh[];
  update(f: WaterLifeFrame): void;
  /** In place of `update` for a lake the renderer leaves out this frame
   * (spec §10.3): nothing drawn, nothing heard, nothing stepped, as beyond
   * its own reach; the next `update` starts the presence again from the
   * weather's own. */
  rest(): void;
  /** This frame's sound: one object, reused, refilled by each `update`;
   * `hums[r]` is the swarm of the table's row r. */
  sound(): WaterLifeSound;
  dispose(): void;
};

/**
 * The life of `lake` in `scene`, placed from the world's `seed`, its midges
 * capped by `tier` and toned for the frame's `colourPath`, as the sky dome is.
 * `made` is the lake's layout made ahead, without its `lake` and with the
 * far chorus's places (`preparedScene.ts`); absent or null, it is laid out
 * and the shore walked here.
 */
export function createWaterLife(
  scene: Scene, seed: number, lake: LakeSource, tier: QualityTier, colourPath: "post" | "material",
  made?: WaterLifeMade | null,
): WaterLife {
  const life = createWaterLifeScene(seed, lake, tier, made);
  const midges = createMidgeSwarms(scene, life.blocks, colourPath);
  midges.mesh.setEnabled(false);
  const dragonflyMeshes = createDragonflyMeshes(scene);
  const draws: WaterLifeDraws = {
    midges(frame) {
      if (frame === null) {
        midges.mesh.setEnabled(false);
        return;
      }
      midges.mesh.setEnabled(true);
      midges.update(frame);
    },
    dragonflies(units, worldSeed) {
      dragonflyMeshes.update(units, worldSeed);
    },
  };
  const meshes = [midges.mesh, ...dragonflyMeshes.meshes];
  for (const mesh of meshes) mesh.alphaIndex = ALPHA_INDEX;
  let disposed = false;

  return {
    meshes,
    update(f) {
      life.update(f, draws);
    },
    rest() {
      life.rest(draws);
    },
    sound: () => life.sound(),
    dispose() {
      if (disposed) return;
      disposed = true;
      life.dispose();
      midges.dispose();
      dragonflyMeshes.dispose();
    },
  };
}
