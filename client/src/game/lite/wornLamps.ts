/**
 * The lamps the other hikers wear, as lights on the world on Babylon Lite:
 * a spot light each, at the hiker's eyes and along their aim, at the state
 * the frame gives every lamp alike (`lampParams.ts`).
 *
 * **A light is made for a hiker, not for a seat.** Lite's materials loop
 * over the lights the scene holds, so it
 * holds the lens's lamp, the sun, the fill and one lamp for each other
 * hiker there has been at once: a hike alone lights with three.
 *
 * Lite builds what a mesh is drawn with for the lights its scene held when
 * the mesh was built, so a light added later lights nothing until every
 * mesh is built again (`rebuildSceneRenderables`). The lights are therefore
 * made before the scene is registered for the hikers already there, and
 * the scene is built again only when one more than ever before joins. A
 * hiker who leaves leaves their light, dark. While the scene is being
 * built again nothing of it may be drawn: Lite lets go of what the meshes
 * were drawn with as it goes, and a frame drawn meanwhile reads buffers
 * already gone. So the renderer draws no frame until the building is done
 * (`rebuilding`): the picture stands still for those frames, at a join.
 *
 * A lamp is written only where it has moved: a dark one costs nothing a
 * frame, a lit one that stands still nothing either.
 */
import {
  addToScene, createSpotLight, markLightDirty, rebuildSceneRenderables, removeFromScene,
  type SceneContext, type SpotLight,
} from "@babylonjs/lite";
import { LAMP_ANGLE, LAMP_COLOUR, LAMP_EXPONENT, LAMP_RANGE, type LampState } from "@csarkosh/engine/game/lampParams";
import type { WornLamp } from "./entityMeshes.js";

export type WornLamps = {
  /** Lights made. */
  readonly count: number;
  /**
   * Lights the frame's lamps, at `state`. Where there are more lamps than
   * lights, the lights are made and every mesh built again for them; the
   * new lamps light from the frame that is done.
   */
  update(lamps: readonly WornLamp[], state: LampState): void;
  /** Light changes sent this frame, for the counts. */
  readonly written: number;
  /** Whether the scene is being built again for a new light: no frame is drawn meanwhile. */
  readonly rebuilding: boolean;
  dispose(): void;
};

type Written = { intensity: number; r: number; g: number; b: number; x: number; y: number; z: number; dx: number; dy: number; dz: number };

/** The lamps of `scene`, `first` of them made now: before the scene is registered, for the hikers already there. */
export function createWornLamps(scene: SceneContext, first: number): WornLamps {
  const lights: SpotLight[] = [];
  const written: Written[] = [];
  let rebuilding = false;
  let disposed = false;
  let sent = 0;

  function make(): void {
    const light = createSpotLight([0, 0, 0], [0, 0, 1], LAMP_ANGLE, LAMP_EXPONENT, 0);
    light.range = LAMP_RANGE;
    light.diffuse = [LAMP_COLOUR[0], LAMP_COLOUR[1], LAMP_COLOUR[2]];
    light.specular = [LAMP_COLOUR[0], LAMP_COLOUR[1], LAMP_COLOUR[2]];
    addToScene(scene, light);
    lights.push(light);
    written.push({ intensity: 0, r: LAMP_COLOUR[0], g: LAMP_COLOUR[1], b: LAMP_COLOUR[2], x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 });
  }
  for (let i = 0; i < first; i++) make();

  return {
    get count() {
      return lights.length;
    },
    get written() {
      return sent;
    },
    get rebuilding() {
      return rebuilding;
    },
    update(lamps, state) {
      if (disposed) return;
      sent = 0;
      if (lamps.length > lights.length && !rebuilding) {
        // One more hiker than there has ever been: their light joins, and every mesh is built again to be lit by it.
        while (lights.length < lamps.length) make();
        rebuilding = true;
        void rebuildSceneRenderables(scene)
          .catch((error: unknown) => {
            if (!disposed) console.error("the hikers' lamps could not be given to the world's meshes; a lamp may light nothing", error);
          })
          .finally(() => {
            rebuilding = false;
          });
      }
      const { r, g, b } = state.colour;
      for (let i = 0; i < lights.length; i++) {
        const light = lights[i] as SpotLight;
        const w = written[i] as Written;
        const lamp = lamps[i];
        const intensity = lamp !== undefined && lamp.on ? state.intensity : 0;
        const lit = intensity > 0 && lamp !== undefined;
        const moved = lit && (w.x !== lamp.x || w.y !== lamp.y || w.z !== lamp.z || w.dx !== lamp.dx || w.dy !== lamp.dy || w.dz !== lamp.dz);
        const recoloured = lit && (w.r !== r || w.g !== g || w.b !== b);
        if (intensity === w.intensity && !moved && !recoloured) continue;
        w.intensity = intensity;
        light.intensity = intensity;
        if (lit) {
          w.x = light.position.x = lamp.x;
          w.y = light.position.y = lamp.y;
          w.z = light.position.z = lamp.z;
          w.dx = light.direction.x = lamp.dx;
          w.dy = light.direction.y = lamp.dy;
          w.dz = light.direction.z = lamp.dz;
          // Its highlight takes its own colour, as the lens's lamp's does.
          w.r = r;
          w.g = g;
          w.b = b;
          light.diffuse = [r, g, b];
          light.specular = [r, g, b];
        }
        markLightDirty(light);
        sent++;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const light of lights) removeFromScene(scene, light);
      lights.length = 0;
    },
  };
}
