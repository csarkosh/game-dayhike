/**
 * The surf's spray: on the high tier, a short burst of soft sprites at each
 * plunge on the cove's face, thrown shoreward and up at the lip's speed,
 * pulled down by gravity, slowed by drag and carried by the wind, each living
 * one to two seconds and fading out.
 *
 * One thin-instanced unit quad per sprite, SURF_SPRAY_BURSTS slots of
 * SURF_SPRAY_PER_BURST made once, the matrices identities and a static
 * per-instance seed and slot, placed each frame by the vertex stage of a small
 * material plugin (`SprayPlugin`, `shaders/surfSpray.vertex.fx`) on an
 * unlit, alpha-blended Standard material, as the rain's splashes are
 * (`rainSplash.ts`): the material brings the fog, the blend, the
 * thin-instance includes and the plugin numbering the WGSL map keys on
 * (`pluginNumbers.ts`).
 *
 * `burst` claims the slot started longest ago (one never started first) and
 * writes its origin, its direction and its speed, and keeps its start;
 * `update` writes each slot's age, so the GPU never sees the shared seconds'
 * large values, only an age of a few seconds. A slot never started holds an
 * age past every life and draws nothing; with no slot alive the mesh is off
 * and costs nothing. Nothing is made after `createSurfSpray`.
 *
 * A sprite's path is the closed form of a throw under gravity with linear
 * drag toward the wind's velocity, v' = −c(v − w) − g ŷ: p(t) = p0 + w′t +
 * (v0 − w′)(1 − e^(−ct))/c, with w′ = w − (g/c) ŷ. `sprayPointAt` is the
 * vertex stage's twin, constant for constant (the lockstep test holds them).
 * The wind's velocity is the wind record's direction at its speed times
 * WIND_SEA_U_PER_WIND, the sea's own reading of the game's wind.
 *
 * The colour is the foam's white (OCEAN_FOAM_ALBEDO) under the scene's sun
 * and fill, at their colours and intensities as the lighting last set them,
 * written each frame a burst is alive. The mesh draws after the sea, in the
 * group it is given (the see-through effects', `effectsGroupFor`), at the
 * last alpha index, depth-tested but not written, never picked, never a
 * shadow caster or receiver, its bounding info unsynced and always active.
 *
 * Renderer-only by design: nothing here may migrate into sim/.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
// Non-.pure path, load-bearing (Babylon 9 split — see lighting.ts).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Material } from "@babylonjs/core/Materials/material.js";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";

import vertexDefs from "./shaders/surfSpray.vertex.fx?raw";
import fragmentDefs from "./shaders/surfSpray.fragment.fx?raw";
import {
  SURF_SPRAY_BURSTS, SURF_SPRAY_PER_BURST, SURF_SPRAY_SEED, SURF_SPRAY_SLOT_FLOATS, createSprayBursts, sprayColour, spraySeeds, spraySlots, sprayWind,
  type SprayLight,
} from "./sprayField.js";
import type { WindRecord } from "./windParams.js";

// The sprites' seeds, the slots and their ages, a sprite's path and the spray's colour are kept with no engine
// (`sprayField.ts`), and handed on under their names.
export {
  SURF_SPRAY_BURSTS, SURF_SPRAY_DRAG, SURF_SPRAY_ELEVATION, SURF_SPRAY_G, SURF_SPRAY_LIFE_S, SURF_SPRAY_OPACITY, SURF_SPRAY_PER_BURST, SURF_SPRAY_RANGE_M,
  SURF_SPRAY_SIZE_M, SURF_SPRAY_SPEED_MIN, SURF_SPRAY_STRETCH_M, sprayPointAt, spraySeeds, type SprayBurst, type SprayPoint,
} from "./sprayField.js";

/** The lights the spray takes its colour from, as the lighting names them (`lighting.ts`). */
const LIGHTS: readonly string[] = ["sun", "fill"];

const SPRAY_VERTEX_POSITION = `
#ifdef SPRAY
{
  vec4 sprayAt = sprayPlace(position.xy);
  positionUpdated = sprayAt.xyz;
  vSprayAlpha = sprayAt.w;
  vSprayUv = position.xy + 0.5;
}
#endif
`;

const SPRAY_FRAGMENT_BEFORE_FRAGCOLOR = `
#ifdef SPRAY
color.a *= sprayCover();
#endif
`;

export class SprayPlugin extends MaterialPluginBase {
  /** The slots, SURF_SPRAY_SLOT_FLOATS floats each: (x, y, z, age), (dirX, dirZ, speed, 0). Written in place. */
  readonly bursts = new Float32Array(SURF_SPRAY_BURSTS * SURF_SPRAY_SLOT_FLOATS);
  /** The eye. */
  camX = 0;
  camY = 0;
  camZ = 0;
  /** The wind's velocity, level (m/s). */
  windX = 0;
  windZ = 0;

  constructor(material: Material) {
    super(material, "Spray", 230, { SPRAY: false });
    this._enable(true);
  }

  override getClassName(): string {
    return "SprayPlugin";
  }

  // One line, for the eslint-disable reason foliagePlugin.ts records.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.SPRAY = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("spraySeed", "sprayBurst");
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string; arraySize?: number }[]; vertex: string; fragment: string;
  } {
    return {
      ubo: [
        { name: "surfSprayBursts", size: 4, type: "vec4", arraySize: SURF_SPRAY_BURSTS * 2 },
        { name: "surfSprayCam", size: 3, type: "vec3" },
        { name: "surfSprayWind", size: 2, type: "vec2" },
      ],
      vertex: `
#ifdef SPRAY
uniform vec4 surfSprayBursts[${SURF_SPRAY_BURSTS * 2}];
uniform vec3 surfSprayCam;
uniform vec2 surfSprayWind;
#endif
`,
      fragment: "",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloatArray("surfSprayBursts", this.bursts);
    uniformBuffer.updateFloat3("surfSprayCam", this.camX, this.camY, this.camZ);
    uniformBuffer.updateFloat2("surfSprayWind", this.windX, this.windZ);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return { CUSTOM_VERTEX_DEFINITIONS: vertexDefs, CUSTOM_VERTEX_UPDATE_POSITION: SPRAY_VERTEX_POSITION };
    }
    if (shaderType === "fragment") {
      return { CUSTOM_FRAGMENT_DEFINITIONS: fragmentDefs, CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: SPRAY_FRAGMENT_BEFORE_FRAGCOLOR };
    }
    return null;
  }
}

export type SurfSpray = {
  readonly mesh: Mesh;
  readonly plugin: SprayPlugin;
  /** A burst at (`x`, `y`, `z`) thrown along the level direction (`dirX`,
   * `dirZ`) at `speed` (m/s), starting at the shared `seconds`: it takes the
   * slot started longest ago. A burst with a value that is not a finite
   * number is not made. */
  burst(x: number, y: number, z: number, dirX: number, dirZ: number, speed: number, seconds: number): void;
  /** Per frame: each slot's age at the shared `seconds`, the eye, the wind
   * and the light; the mesh drawn only while a slot is alive. */
  update(seconds: number, wind: WindRecord): void;
  dispose(): void;
};

/** The spray, in rendering group `group`. */
export function createSurfSpray(scene: Scene, group: number): SurfSpray {
  const count = SURF_SPRAY_BURSTS * SURF_SPRAY_PER_BURST;
  const mat = new StandardMaterial("mat_surf_spray", scene);
  mat.disableLighting = true;
  mat.emissiveColor.set(0, 0, 0);
  mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mat.fogEnabled = true;
  const plugin = new SprayPlugin(mat);

  const mesh = MeshBuilder.CreatePlane("surf_spray", { size: 1 }, scene);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.renderingGroupId = group;
  // After the sea and every other blended mesh of its group: its bounds are
  // unsynced, so a sort by distance would mean nothing.
  mesh.alphaIndex = Number.POSITIVE_INFINITY;
  const matrices = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    matrices[i * 16] = 1;
    matrices[i * 16 + 5] = 1;
    matrices[i * 16 + 10] = 1;
    matrices[i * 16 + 15] = 1;
  }
  mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
  mesh.thinInstanceSetBuffer("spraySeed", spraySeeds(count, SURF_SPRAY_SEED), 4, true);
  mesh.thinInstanceSetBuffer("sprayBurst", spraySlots(count), 1, true);
  mesh.setEnabled(false);

  // The slots are kept and aged with no engine (`sprayField.ts`), in the plugin's own array.
  const bursts = createSprayBursts(plugin.bursts);
  const windNow: [number, number] = [0, 0];
  const colour: [number, number, number] = [0, 0, 0];
  const lit: SprayLight[] = [];

  return {
    mesh,
    plugin,
    burst(x, y, z, dirX, dirZ, speed, seconds) {
      bursts.burst(x, y, z, dirX, dirZ, speed, seconds);
    },
    update(seconds, wind) {
      const alive = bursts.age(seconds);
      mesh.setEnabled(alive);
      if (!alive) return;
      // The eye as the camera last stood: a sprite faces it a frame late at most.
      const eye = scene.activeCamera?.position;
      if (eye !== undefined) {
        plugin.camX = eye.x;
        plugin.camY = eye.y;
        plugin.camZ = eye.z;
      }
      sprayWind(wind, windNow);
      plugin.windX = windNow[0];
      plugin.windZ = windNow[1];
      lit.length = 0;
      for (let i = 0; i < LIGHTS.length; i++) {
        const light = scene.getLightByName(LIGHTS[i] as string);
        if (light !== null) lit.push({ r: light.diffuse.r, g: light.diffuse.g, b: light.diffuse.b, intensity: light.intensity });
      }
      sprayColour(lit, colour);
      mat.emissiveColor.set(colour[0], colour[1], colour[2]);
    },
    dispose() {
      mesh.dispose();
      mat.dispose();
    },
  };
}
