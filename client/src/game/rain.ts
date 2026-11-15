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

import type { QualityTier } from "./quality.js";
import type { WindRecord } from "./windParams.js";
import { attachRain, type RainPlugin } from "./rainPlugin.js";
import type { RainMap } from "./rainMap.js";
import { DRIP_SEED, RAIN_SEED, RAIN_TEX_H, RAIN_TEX_W, createRainField, rainStreakMap, type RainLamp, type RainUniforms } from "./rainField.js";
import { DRIP, DRIP_TIERS, RAIN_TIERS, rainSeeds } from "./rainParams.js";
import type { WeatherParams } from "./weather.js";

export { RAIN_TEX_H, RAIN_TEX_W, rainStreakMap, type RainLamp };

/** A volume's uniforms for the frame (`rainField.ts`) into its plugin's fields, which it binds from. */
function handPlugin(p: RainPlugin, u: RainUniforms): void {
  p.boxMinX = u.rainBoxMin[0];
  p.boxMinY = u.rainBoxMin[1];
  p.boxMinZ = u.rainBoxMin[2];
  p.driftX = u.rainDrift[0];
  p.driftZ = u.rainDrift[1];
  p.fold = u.rainFold[0];
  p.dt = u.rainDt[0];
  p.windX = u.rainWind[0];
  p.windZ = u.rainWind[1];
  p.camX = u.rainCam[0];
  p.camY = u.rainCam[1];
  p.camZ = u.rainCam[2];
  p.lampX = u.rainLampPos[0];
  p.lampY = u.rainLampPos[1];
  p.lampZ = u.rainLampPos[2];
  p.lampDirX = u.rainLampDir[0];
  p.lampDirY = u.rainLampDir[1];
  p.lampDirZ = u.rainLampDir[2];
  p.lampIntensity = u.rainLamp[0];
  p.lampCosHalf = u.rainLamp[1];
  p.lampR = u.rainLampColour[0];
  p.lampG = u.rainLampColour[1];
  p.lampB = u.rainLampColour[2];
  p.canopyWater = u.rainCanopyWater[0];
  p.mapCentreX = u.rainMapCentre[0];
  p.mapCentreZ = u.rainMapCentre[1];
}

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
  /** The cover map the streaks fade under and the drips fall under
   * (`rainMap.ts`), or null for none: sets both plugins' `RAIN_OCCLUSION`
   * and binds the map's texture and centre on every update after. */
  setMap(map: RainMap | null): void;
  dispose(): void;
  mesh: Mesh;
  plugin: RainPlugin;
  /** The drip volume, on the tiers that draw one (DRIP_TIERS); else null. */
  drips: Mesh | null;
  dripPlugin: RainPlugin | null;
  /** The canopy's water, 0 to 1, stepped by every `update`
   * (`canopyWaterStep`, `weather.ts`): the one value the drawn drips and
   * the heard ones (`ambientAudio.ts`, through the renderer) follow. */
  readonly canopyWater: number;
};

/**
 * One thin-instanced unit quad per streak, placed each frame by the vertex
 * stage (`rainPlugin.ts`) inside a box locked to the camera, so the box is
 * full at every height on every frame and nothing is respawned or uploaded
 * per frame: the matrix buffer is identities and the seed buffer is static,
 * both set once here. `update` steps the rain's field (`rainField.ts`: the
 * folded time, the wind's drift, the smoothed frame duration, the canopy's
 * water, the counts and each volume's uniforms), hands the plugin its
 * uniforms and sets the instance count to the rain value's share of the
 * tier's streaks; at `rain 0` the mesh is disabled and costs nothing.
 *
 * The material is unlit and alpha-blended, depth-tested but not written, not
 * culled, and fogged by the scene's fog so the far streaks sink into the
 * haze; its colour is the fog colour lifted by RAIN_MILK. The mesh is always
 * active (the box surrounds the camera), never picked, never a shadow caster
 * or receiver, and its bounding info is not synced.
 *
 * The drips are a second such mesh on the tiers that draw them, with a
 * material of its own on the same streak texture and its own plugin under
 * `RAIN_DRIP`, in the shorter DRIP.box; they show only under the cover map's
 * canopy (`rainPlugin.ts`), so without a map the mesh stays disabled. Their
 * count follows the canopy's water, stepped by the field from the rain value
 * and the frame (`canopyWaterStep`): the trees start dripping about a minute
 * into the rain and keep dripping for ten minutes after it stops.
 */
export function createRain(scene: Scene, tier: QualityTier): Rain {
  const count = RAIN_TIERS[tier];
  const dripCount = DRIP_TIERS[tier];
  const tex = RawTexture.CreateRGBATexture(
    rainStreakMap(), RAIN_TEX_W, RAIN_TEX_H, scene, true, false,
    Texture.TRILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE,
  );
  tex.hasAlpha = true;

  const material = (name: string): StandardMaterial => {
    const mat = new StandardMaterial(name, scene);
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
    return mat;
  };
  const volume = (name: string, mat: StandardMaterial, drops: number, seed: number, alphaIndex: number): Mesh => {
    const mesh = MeshBuilder.CreatePlane(name, { size: 1 }, scene);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    // Unsynced bounding info leaves the blended sort keyed on the world origin;
    // the rain is the nearest blended volume, so it draws last in its group,
    // in the order splashes (`rainSplash.ts`), drips, streaks: nearest last.
    mesh.alphaIndex = alphaIndex;
    const matrices = new Float32Array(drops * 16);
    for (let i = 0; i < drops; i++) {
      matrices[i * 16] = 1;
      matrices[i * 16 + 5] = 1;
      matrices[i * 16 + 10] = 1;
      matrices[i * 16 + 15] = 1;
    }
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, true);
    mesh.thinInstanceSetBuffer("rainSeed", rainSeeds(drops, seed), 4, true);
    mesh.setEnabled(false);
    return mesh;
  };

  const mat = material("mat_rain");
  const plugin = attachRain(mat);
  const mesh = volume("rain_streaks", mat, count, RAIN_SEED, Number.MAX_SAFE_INTEGER);

  const dripMat = dripCount > 0 ? material("mat_rain_drips") : null;
  const dripPlugin = dripMat === null ? null : attachRain(dripMat);
  if (dripPlugin !== null) {
    dripPlugin.drip = true;
    dripPlugin.boxX = DRIP.box.x;
    dripPlugin.boxY = DRIP.box.y;
    dripPlugin.boxZ = DRIP.box.z;
  }
  const drips = dripMat === null ? null : volume("rain_drips", dripMat, dripCount, DRIP_SEED, Number.MAX_SAFE_INTEGER - 1);
  const plugins = dripPlugin === null ? [plugin] : [plugin, dripPlugin];

  const field = createRainField(tier);
  let map: RainMap | null = null;

  return {
    mesh,
    plugin,
    drips,
    dripPlugin,
    get canopyWater() {
      return field.canopyWater;
    },
    setMap(next) {
      map = next;
      for (const p of plugins) {
        p.map = next === null ? null : next.texture;
        p.occlusion = next !== null;
      }
    },
    update(camPos, yaw, w, wind, dt, lamp) {
      const shown = field.step(camPos, yaw, w, wind, dt, lamp, scene.fogColor, map === null ? null : map.centre);
      if (field.drawn > 0) mesh.thinInstanceCount = field.drawn;
      mesh.setEnabled(field.drawn > 0);
      if (drips !== null) {
        if (field.dripping > 0) drips.thinInstanceCount = field.dripping;
        drips.setEnabled(field.dripping > 0);
      }
      if (!shown) return;

      mat.emissiveColor.set(field.milk[0], field.milk[1], field.milk[2]);
      dripMat?.emissiveColor.set(field.milk[0], field.milk[1], field.milk[2]);
      handPlugin(plugin, field.streaks);
      if (dripPlugin !== null && field.drips !== null) handPlugin(dripPlugin, field.drips);
    },
    dispose() {
      mesh.dispose();
      mat.dispose();
      drips?.dispose();
      dripMat?.dispose();
      tex.dispose();
    },
  };
}
