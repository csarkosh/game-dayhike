/**
 * A lake's life on Babylon Lite: its midges and its dragonflies drawn, its
 * frogs heard, where and when the game has them. The life itself is the
 * game's own, stepped with no engine (`waterLifeScene.ts`: the presence by
 * the hour, the weather, the wind and the dread, the swarms' table, the
 * dragonflies' state machines, the chorus, and the sound of it all); this
 * module hands what a frame stepped to the two modules that draw it
 * (`midgeMeshes.ts`, `dragonflyMeshes.ts`).
 *
 * A lake out of the camera's reach is rested, not stepped: nothing of it is
 * drawn, heard or written. Within reach, a swarm or a kind of dragonfly is
 * drawn only while the view's planes hold it.
 */
import type { EngineContext, MaterialPlugin, PluginUniformBlock, SceneContext } from "@babylonjs/lite";
import type { LakeSource } from "../../sim/terrain.js";
import type { ViewPlane } from "@csarkosh/engine/game/lakeSeen";
import type { QualityTier } from "@csarkosh/engine/game/quality";
import type { WaterLifeSound } from "../waterLifeAudio.js";
import type { WaterLifeMade } from "../waterLifeField.js";
import { createWaterLifeScene, type WaterLifeDraws, type WaterLifeFrame } from "../waterLifeScene.js";
import { createLiteDragonflies } from "./dragonflyMeshes.js";
import type { FrameUploads } from "@csarkosh/engine/game/lite/frameUploads";
import { createLiteMidges } from "./midgeMeshes.js";

export type LiteWaterLife = {
  /** A frame of the life, stepped and drawn; the midges toned by the frame's `exposure` and `contrast`. */
  update(f: WaterLifeFrame, exposure: number, contrast: number): void;
  /** In place of `update` for a lake left out this frame: nothing drawn, heard or stepped. */
  rest(): void;
  /** This frame's sound: one object, reused. */
  sound(): WaterLifeSound;
  /** What is drawn now: the midges' one draw or none, the dragonflies there are by kind, and the kinds drawn. */
  drawn(): { midges: boolean; midgeInstances: number; dragonflies: readonly [number, number, number]; kinds: number };
  dispose(): void;
};

/** The life of `lake` in `scene`, placed from the world's `seed`, its midges capped by `tier`; `made` is its layout made ahead. */
export function createLiteWaterLife(
  engine: EngineContext, scene: SceneContext, seed: number, lake: LakeSource, tier: QualityTier,
  options: {
    air: () => MaterialPlugin; shared: PluginUniformBlock; planes: () => readonly ViewPlane[]; made?: WaterLifeMade | null; uploads?: FrameUploads;
    /** A post chain grades the frame: the midges hand their light on as it is. */
    linear?: boolean;
  },
): LiteWaterLife {
  const life = createWaterLifeScene(seed, lake, tier, options.made);
  const midges = createLiteMidges(engine, scene, life.blocks, options.planes, options.uploads);
  const dragonflies = createLiteDragonflies(engine, scene, options);
  /** The display's curve for the frame being stepped: the midges tone their own light. */
  let exposure = 1;
  let contrast = 1;
  const draws: WaterLifeDraws = {
    midges(frame) {
      midges?.show(frame, exposure, contrast, options.linear !== true);
    },
    dragonflies(units, worldSeed) {
      dragonflies.update(units, worldSeed);
    },
  };
  return {
    update(f, frameExposure, frameContrast) {
      exposure = frameExposure;
      contrast = frameContrast;
      life.update(f, draws);
    },
    rest() {
      life.rest(draws);
    },
    sound: () => life.sound(),
    drawn: () => ({ midges: midges?.shown ?? false, midgeInstances: midges?.instances ?? 0, dragonflies: dragonflies.counts, kinds: dragonflies.shown }),
    dispose() {
      life.dispose();
      midges?.dispose();
      dragonflies.dispose();
    },
  };
}
