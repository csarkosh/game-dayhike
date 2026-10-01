import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
// Non-.pure path, load-bearing (Babylon 9 split — see lighting.ts).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Material } from "@babylonjs/core/Materials/material.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import "@babylonjs/core/Meshes/thinInstanceMesh.js";

import { clamp01 } from "./colour.js";
import type { WeatherParams } from "./weather.js";
import type { QualityTier } from "./quality.js";
import type { WindRecord } from "./windParams.js";
import { attachRain, type RainPlugin } from "./rainPlugin.js";
import type { RainMap } from "./rainMap.js";
import {
  RAIN_LAMP_GAIN, RAIN_MILK, RAIN_SLANT, RAIN_TIERS, rainBoxMin, rainCountUnder, rainDrift, rainFold,
  rainSeeds, smoothedDt,
} from "./rainParams.js";

export const RAIN_TEX_W = 4;
export const RAIN_TEX_H = 16;

/** A thin vertical streak: white, alpha peaking mid-column and fading at the ends. */
export function rainStreakMap(): Uint8Array {
  const data = new Uint8Array(RAIN_TEX_W * RAIN_TEX_H * 4);
  for (let y = 0; y < RAIN_TEX_H; y++) {
    const t = (y + 0.5) / RAIN_TEX_H;
    const vertical = Math.sin(Math.PI * t); // 0 at the ends, 1 in the middle
    for (let x = 0; x < RAIN_TEX_W; x++) {
      const nx = ((x + 0.5) / RAIN_TEX_W) * 2 - 1;
      const across = 1 - nx * nx;
      const i = (y * RAIN_TEX_W + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(200 * vertical * across);
    }
  }
  return data;
}

/** The seed buffer's hash seed: the streaks' layout is the same on every load. */
const RAIN_SEED = 0x5261696e;

/** The local headlamp as the streaks read it: its world position, its
 * direction, its intensity (0 when off), its cone angle in radians and its
 * colour. */
export type RainLamp = {
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;
  intensity: number;
  angle: number;
  r: number; g: number; b: number;
};

export type Rain = {
  /** `yaw` is the camera's, Babylon's rotation.y; `dt` the frame's seconds. */
  update(
    camPos: { x: number; y: number; z: number },
    yaw: number,
    w: WeatherParams,
    wind: WindRecord,
    dt: number,
    lamp: RainLamp,
  ): void;
  /** The cover map the streaks fade under (`rainMap.ts`), or null for none:
   * sets the plugin's `RAIN_OCCLUSION` and binds the map's texture and
   * centre on every update after. */
  setMap(map: RainMap | null): void;
  dispose(): void;
  mesh: Mesh;
  plugin: RainPlugin;
};

/**
 * One thin-instanced unit quad per streak, placed each frame by the vertex
 * stage (`rainPlugin.ts`) inside a box locked to the camera, so the box is
 * full at every height on every frame and nothing is respawned or uploaded
 * per frame: the matrix buffer is identities and the seed buffer is static,
 * both set once here. `update` folds the time, steps the wind's drift,
 * smooths the frame duration, hands the plugin its uniforms and sets the
 * instance count to the rain value's share of the tier's streaks; at `rain 0`
 * the mesh is disabled and costs nothing.
 *
 * The material is unlit and alpha-blended, depth-tested but not written, not
 * culled, and fogged by the scene's fog so the far streaks sink into the
 * haze; its colour is the fog colour lifted by RAIN_MILK. The mesh is always
 * active (the box surrounds the camera), never picked, never a shadow caster
 * or receiver, and its bounding info is not synced.
 */
export function createRain(scene: Scene, tier: QualityTier): Rain {
  const count = RAIN_TIERS[tier];
  const tex = RawTexture.CreateRGBATexture(
    rainStreakMap(), RAIN_TEX_W, RAIN_TEX_H, scene, true, false,
    Texture.TRILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.hasAlpha = true;

  const mat = new StandardMaterial("mat_rain", scene);
  mat.disableLighting = true;
  mat.emissiveColor.set(1, 1, 1);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  // Blend only: with the mode unset, a diffuse texture with alpha is also
  // alpha-TESTED, and a discard in the fragment stage would cost every streak
  // its early depth rejection.
  mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mat.fogEnabled = true;
  const plugin = attachRain(mat);

  const mesh = MeshBuilder.CreatePlane("rain_streaks", { size: 1 }, scene);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  // Unsynced bounding info leaves the blended sort keyed on the world origin;
  // the rain is the nearest blended volume, so it draws last in its group.
  mesh.alphaIndex = Number.MAX_SAFE_INTEGER;
  const matrices = new Float32Array(count * 16);
  for (let i = 0; i < count; i++) {
    matrices[i * 16] = 1;
    matrices[i * 16 + 5] = 1;
    matrices[i * 16 + 10] = 1;
    matrices[i * 16 + 15] = 1;
  }
  mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
  mesh.thinInstanceSetBuffer("rainSeed", rainSeeds(count, RAIN_SEED), 4, true);
  mesh.setEnabled(false);

  let fold = 0;
  const drift = { x: 0, z: 0 };
  const boxMin = { x: 0, y: 0, z: 0 };
  let dtSmooth = 1 / 60;
  let map: RainMap | null = null;

  return {
    mesh,
    plugin,
    setMap(next) {
      map = next;
      plugin.map = next === null ? null : next.texture;
      plugin.occlusion = next !== null;
    },
    update(camPos, yaw, w, wind, dt, lamp) {
      // The clocks step whether or not it rains, at most a second a frame: a
      // suspended tab resumes where it left off instead of lurching.
      const step = Math.min(1, Math.max(0, dt));
      fold = rainFold(fold + step);
      rainDrift(drift, wind, step, drift);
      dtSmooth = smoothedDt(dtSmooth, step);
      const drawn = rainCountUnder(w.rain, tier);
      if (drawn === 0) {
        mesh.setEnabled(false);
        return;
      }
      mesh.thinInstanceCount = drawn;
      mesh.setEnabled(true);

      rainBoxMin(camPos, yaw, boxMin);
      plugin.boxMinX = boxMin.x;
      plugin.boxMinY = boxMin.y;
      plugin.boxMinZ = boxMin.z;
      plugin.driftX = drift.x;
      plugin.driftZ = drift.z;
      plugin.fold = fold;
      plugin.dt = dtSmooth;
      const slant = RAIN_SLANT * wind.speed;
      plugin.windX = wind.dirX * slant;
      plugin.windZ = wind.dirZ * slant;
      plugin.camX = camPos.x;
      plugin.camY = camPos.y;
      plugin.camZ = camPos.z;
      plugin.lampX = lamp.x;
      plugin.lampY = lamp.y;
      plugin.lampZ = lamp.z;
      plugin.lampDirX = lamp.dx;
      plugin.lampDirY = lamp.dy;
      plugin.lampDirZ = lamp.dz;
      plugin.lampIntensity = lamp.intensity * RAIN_LAMP_GAIN;
      plugin.lampCosHalf = Math.cos(lamp.angle / 2);
      plugin.lampR = lamp.r;
      plugin.lampG = lamp.g;
      plugin.lampB = lamp.b;
      if (map !== null) {
        plugin.mapCentreX = map.centre.x;
        plugin.mapCentreZ = map.centre.z;
      }

      const fog = scene.fogColor;
      mat.emissiveColor.set(
        clamp01(fog.r * RAIN_MILK.gain + RAIN_MILK.lift),
        clamp01(fog.g * RAIN_MILK.gain + RAIN_MILK.lift),
        clamp01(fog.b * RAIN_MILK.gain + RAIN_MILK.lift),
      );
    },
    dispose() {
      mesh.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
