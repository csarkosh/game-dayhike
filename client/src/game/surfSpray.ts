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
import { WIND_SEA_U_PER_WIND } from "./oceanWindSea.js";
import { OCEAN_FOAM_ALBEDO } from "./waterShading.js";
import type { WindRecord } from "./windParams.js";

/** Sprites a burst. */
export const SURF_SPRAY_PER_BURST = 60;
/** Burst slots: at most this many bursts live at once. */
export const SURF_SPRAY_BURSTS = 6;
/** A sprite's life (s), from the first to the second by its seed. */
export const SURF_SPRAY_LIFE_S: readonly [number, number] = [1, 2];
/** Linear drag toward the wind's velocity (1/s). */
export const SURF_SPRAY_DRAG = 1.5;
/** A sprite's full width (m), at the end of its life; half that at its start. */
export const SURF_SPRAY_SIZE_M = 0.6;
/** Gravity (m/s²). */
export const SURF_SPRAY_G = 9.81;
/** The stretch (m) across the throw a burst's sprites start along: a plunge's (`LIP_STRETCH_M`). */
export const SURF_SPRAY_STRETCH_M = 20;
/** The throw's elevation above level (rad), from the first to the second by a sprite's seed. */
export const SURF_SPRAY_ELEVATION: readonly [number, number] = [0.35, 1.2];
/** The least share of a burst's speed a sprite is thrown at; the most is all of it. */
export const SURF_SPRAY_SPEED_MIN = 0.5;
/** A sprite's cover at its centre while fresh. */
export const SURF_SPRAY_OPACITY = 0.5;
/** Plunges farther than this (m) from the eye throw no spray. */
export const SURF_SPRAY_RANGE_M = 300;

/** The seed buffer's hash seed: the sprites' layout is the same on every load. */
const SPRAY_SEED = 0x53707279;
/** The age written into a slot never started: past every life. */
const NEVER_AGE = SURF_SPRAY_LIFE_S[1] + 1;
/** Floats a slot: (x, y, z, age), (dirX, dirZ, speed, 0). */
const SLOT_FLOATS = 8;
/** The lights the spray takes its colour from, as the lighting names them (`lighting.ts`). */
const LIGHTS: readonly string[] = ["sun", "fill"];

const finite = (v: number): boolean => Number.isFinite(v);

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

/**
 * `count` seeds of four hashes in [0, 1) each, from an integer hash of the
 * index and `seed` (Wang's 32-bit mix, integer arithmetic only, as
 * `rainSeeds`): the same on every load.
 */
export function spraySeeds(count: number, seed: number): Float32Array {
  const out = new Float32Array(count * 4);
  const mix = (v: number): number => {
    let x = v >>> 0;
    x = (x ^ 61) ^ (x >>> 16);
    x = Math.imul(x, 9) >>> 0;
    x = x ^ (x >>> 4);
    x = Math.imul(x, 0x27d4eb2d) >>> 0;
    x = x ^ (x >>> 15);
    return x >>> 0;
  };
  let h = mix(seed >>> 0);
  for (let i = 0; i < count * 4; i++) {
    h = mix(h + 0x9e3779b9);
    out[i] = (h >>> 8) / 16777216;
  }
  return out;
}

/** A burst slot as the vertex stage reads it. */
export type SprayBurst = { x: number; y: number; z: number; age: number; dirX: number; dirZ: number; speed: number };
/** A sprite's centre, its alpha and its width (m). */
export type SprayPoint = { x: number; y: number; z: number; alpha: number; size: number };

/**
 * The vertex stage's `sprayPlace` at the quad's centre, in TypeScript: the
 * sprite of `seed` (four hashes) in `burst`, under a wind of (`windX`,
 * `windZ`) m/s, into `out`.
 */
export function sprayPointAt(
  burst: SprayBurst, seed: ArrayLike<number>, windX: number, windZ: number, out: SprayPoint,
): SprayPoint {
  const h0 = seed[0] as number;
  const h1 = seed[1] as number;
  const h2 = seed[2] as number;
  const h3 = seed[3] as number;
  const life = SURF_SPRAY_LIFE_S[0] + (SURF_SPRAY_LIFE_S[1] - SURF_SPRAY_LIFE_S[0]) * h3;
  const alive = burst.age >= 0 && burst.age < life ? 1 : 0;
  const t = Math.min(Math.max(burst.age, 0), life);
  const along = (h0 - 0.5) * SURF_SPRAY_STRETCH_M;
  const elevation = SURF_SPRAY_ELEVATION[0] + (SURF_SPRAY_ELEVATION[1] - SURF_SPRAY_ELEVATION[0]) * h1;
  const speed = burst.speed * (SURF_SPRAY_SPEED_MIN + (1 - SURF_SPRAY_SPEED_MIN) * h2);
  const vx = burst.dirX * Math.cos(elevation) * speed;
  const vy = Math.sin(elevation) * speed;
  const vz = burst.dirZ * Math.cos(elevation) * speed;
  const fall = -SURF_SPRAY_G / SURF_SPRAY_DRAG;
  const k = (1 - Math.exp(-SURF_SPRAY_DRAG * t)) / SURF_SPRAY_DRAG;
  out.x = burst.x - burst.dirZ * along + windX * t + (vx - windX) * k;
  out.y = burst.y + fall * t + (vy - fall) * k;
  out.z = burst.z + burst.dirX * along + windZ * t + (vz - windZ) * k;
  const lived = t / life;
  out.alpha = (1 - lived) * alive;
  out.size = SURF_SPRAY_SIZE_M * (0.5 + 0.5 * lived) * alive;
  return out;
}

export class SprayPlugin extends MaterialPluginBase {
  /** The slots, SLOT_FLOATS floats each: (x, y, z, age), (dirX, dirZ, speed, 0). Written in place. */
  readonly bursts = new Float32Array(SURF_SPRAY_BURSTS * SLOT_FLOATS);
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
  const slots = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    matrices[i * 16] = 1;
    matrices[i * 16 + 5] = 1;
    matrices[i * 16 + 10] = 1;
    matrices[i * 16 + 15] = 1;
    slots[i] = Math.floor(i / SURF_SPRAY_PER_BURST);
  }
  mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
  mesh.thinInstanceSetBuffer("spraySeed", spraySeeds(count, SPRAY_SEED), 4, true);
  mesh.thinInstanceSetBuffer("sprayBurst", slots, 1, true);
  mesh.setEnabled(false);

  const bursts = plugin.bursts;
  const starts = new Float64Array(SURF_SPRAY_BURSTS).fill(Number.NEGATIVE_INFINITY);
  for (let s = 0; s < SURF_SPRAY_BURSTS; s++) bursts[s * SLOT_FLOATS + 3] = NEVER_AGE;

  return {
    mesh,
    plugin,
    burst(x, y, z, dirX, dirZ, speed, seconds) {
      if (!finite(x) || !finite(y) || !finite(z) || !finite(dirX) || !finite(dirZ) || !finite(speed) || !finite(seconds)) return;
      let slot = 0;
      for (let s = 1; s < SURF_SPRAY_BURSTS; s++) if ((starts[s] as number) < (starts[slot] as number)) slot = s;
      const len = Math.hypot(dirX, dirZ);
      const at = slot * SLOT_FLOATS;
      starts[slot] = seconds;
      bursts[at] = x;
      bursts[at + 1] = y;
      bursts[at + 2] = z;
      bursts[at + 3] = 0;
      bursts[at + 4] = len > 0 ? dirX / len : 1;
      bursts[at + 5] = len > 0 ? dirZ / len : 0;
      bursts[at + 6] = Math.max(0, speed);
      bursts[at + 7] = 0;
    },
    update(seconds, wind) {
      let alive = false;
      for (let s = 0; s < SURF_SPRAY_BURSTS; s++) {
        const start = starts[s] as number;
        const age = Number.isFinite(start) && Number.isFinite(seconds) ? seconds - start : NEVER_AGE;
        bursts[s * SLOT_FLOATS + 3] = age;
        if (age >= 0 && age < SURF_SPRAY_LIFE_S[1]) alive = true;
      }
      mesh.setEnabled(alive);
      if (!alive) return;
      // The eye as the camera last stood: a sprite faces it a frame late at most.
      const eye = scene.activeCamera?.position;
      if (eye !== undefined) {
        plugin.camX = eye.x;
        plugin.camY = eye.y;
        plugin.camZ = eye.z;
      }
      const speed = Number.isFinite(wind.speed) ? Math.min(Math.max(wind.speed, 0), 1) * WIND_SEA_U_PER_WIND : 0;
      plugin.windX = Number.isFinite(wind.dirX) ? wind.dirX * speed : 0;
      plugin.windZ = Number.isFinite(wind.dirZ) ? wind.dirZ * speed : 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < LIGHTS.length; i++) {
        const light = scene.getLightByName(LIGHTS[i] as string);
        if (light === null) continue;
        r += light.diffuse.r * light.intensity;
        g += light.diffuse.g * light.intensity;
        b += light.diffuse.b * light.intensity;
      }
      mat.emissiveColor.set(OCEAN_FOAM_ALBEDO * r, OCEAN_FOAM_ALBEDO * g, OCEAN_FOAM_ALBEDO * b);
    },
    dispose() {
      mesh.dispose();
      mat.dispose();
    },
  };
}
