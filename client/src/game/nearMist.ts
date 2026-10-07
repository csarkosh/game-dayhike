/**
 * The near mist (docs/gameplay/2026-10-06-the-mist-shades.md §1): the mist
 * at the player's face, walked through like a bush. Small puffs round the
 * eye, within arm's reach to a few metres, standing in the world so the
 * player's own walking carries them past and through the eye, each fading
 * as it crosses the near plane so none pops, reborn ahead once behind or
 * left behind. The same grey as the cloud on the ground (hauntMist.ts),
 * outside the scene's fog. Its density is the night's, deeper in the chase
 * and lifted by the haunt, or held at a level from the console (`mist`) for
 * looking at it.
 */
import type { Scene } from "@babylonjs/core/scene.js";
import type { Camera } from "@babylonjs/core/Cameras/camera.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { mistAlphaMap, MIST_TEX_SIZE } from "./mistField.js";
import { HAUNT_MIST_GREY } from "./hauntMist.js";

/** How many puffs, how far from the eye they are born (least and most), and beyond what they are left behind. */
export const NEAR_MIST_PUFFS = 14;
export const NEAR_MIST_BORN: readonly [number, number] = [0.6, 4];
export const NEAR_MIST_LEAVE = 6;
/** A puff's size, how far above or below the eye it is born, its life, and its drift (m/s). */
export const NEAR_MIST_SIZE: readonly [number, number] = [1.5, 4];
export const NEAR_MIST_RISE = 1;
export const NEAR_MIST_LIFE_S: readonly [number, number] = [6, 14];
export const NEAR_MIST_DRIFT = 0.25;
/** Seconds a puff takes to come in and to go, and the metres from the eye over which one crossing it fades, so none pops. */
export const NEAR_MIST_EDGE_S = 1.5;
export const NEAR_MIST_CROSS_M = 0.7;
/** A puff's opacity at a density of 1. */
export const NEAR_MIST_ALPHA = 0.7;
/**
 * The density: the night's with no haunt on, the chase's (reached by its
 * cast), and how much the haunt lifts the night's toward 1. The console's
 * `mist <density>` holds it at a level instead, for looking at it.
 */
export const NEAR_MIST_NIGHT_DENSITY = 0.3;
export const NEAR_MIST_CHASE_DENSITY = 0.7;
export const NEAR_MIST_HAUNT_LIFT = 0.25;

/** The near mist's density for a frame: the night (0 to 1), the haunt's level, and the chase's cast. */
export function nearMistDensity(night: number, haunt: number, chase: number): number {
  const n = clamp01(night), h = clamp01(haunt), c = clamp01(chase);
  const base = NEAR_MIST_NIGHT_DENSITY + (1 - NEAR_MIST_NIGHT_DENSITY) * h * NEAR_MIST_HAUNT_LIFT;
  return n * (base + (NEAR_MIST_CHASE_DENSITY - base) * c);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

type Puff = { mesh: Mesh; x: number; y: number; z: number; size: number; life: number; age: number; weight: number; phase: number; dx: number; dy: number; dz: number };

export type NearMist = {
  /** One frame: the night (0 to 1), the haunt's level, the chase's cast, and the clock. */
  update(camera: Camera, night: number, haunt: number, chase: number, seconds: number): void;
  /** Hold the density at a level (0 to 1) whatever the night, or null to let the night set it again. */
  hold(density: number | null): void;
  /** The density the last frame drew at. */
  density(): number;
  dispose(): void;
};

/** `random` draws the puffs' births. */
export function createNearMist(scene: Scene, random: () => number = Math.random): NearMist {
  const between = (band: readonly [number, number]): number => band[0] + random() * (band[1] - band[0]);
  const tex = RawTexture.CreateRGBATexture(mistAlphaMap(), MIST_TEX_SIZE, MIST_TEX_SIZE, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE);
  tex.hasAlpha = true;
  const mat = new StandardMaterial("mat_near_mist", scene);
  mat.disableLighting = true;
  mat.opacityTexture = tex;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.emissiveColor = Color3.FromHexString(HAUNT_MIST_GREY);
  mat.alpha = NEAR_MIST_ALPHA;
  mat.fogEnabled = false;
  const puffs: Puff[] = [];
  for (let i = 0; i < NEAR_MIST_PUFFS; i++) {
    const mesh = MeshBuilder.CreatePlane(`near_mist_${i}`, { size: 1 }, scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.material = mat;
    mesh.setEnabled(false);
    puffs.push({ mesh, x: 0, y: 0, z: 0, size: 1, life: 0, age: Infinity, weight: 1, phase: 0, dx: 0, dy: 0, dz: 0 });
  }
  let lastSeconds: number | null = null;
  let held: number | null = null;
  let drawn = 0;
  const forward = new Vector3();

  /** A puff born round the eye, ahead of it for choice: a drawn bearing, distance, height, size, life, weight and drift. */
  function born(p: Puff, camera: Camera, stagger: boolean): void {
    // Ahead within a half-turn either side, so a puff is born to be walked into, not behind the eye.
    const a = Math.atan2(forward.x, forward.z) + (random() - 0.5) * Math.PI;
    const r = between(NEAR_MIST_BORN);
    p.x = camera.position.x + Math.sin(a) * r;
    p.z = camera.position.z + Math.cos(a) * r;
    p.y = camera.position.y + (random() * 2 - 1) * NEAR_MIST_RISE;
    p.size = between(NEAR_MIST_SIZE);
    p.life = between(NEAR_MIST_LIFE_S);
    p.age = stagger ? random() * p.life : 0;
    p.weight = 0.5 + random() * 0.5;
    p.phase = random() * Math.PI * 2;
    const d = random() * Math.PI * 2;
    p.dx = Math.sin(d) * NEAR_MIST_DRIFT;
    p.dz = Math.cos(d) * NEAR_MIST_DRIFT;
    p.dy = (random() - 0.5) * NEAR_MIST_DRIFT * 0.4;
  }

  return {
    update(camera, night, haunt, chase, seconds) {
      const density = held ?? nearMistDensity(night, haunt, chase);
      drawn = density;
      const dt = lastSeconds === null ? 0 : Math.max(0, Math.min(0.1, seconds - lastSeconds));
      lastSeconds = seconds;
      if (density <= 0.002) {
        for (const p of puffs) { p.mesh.setEnabled(false); p.age = Infinity; }
        return;
      }
      camera.getDirectionToRef(Vector3.Forward(), forward);
      forward.y = 0;
      if (forward.lengthSquared() < 1e-6) forward.set(0, 0, 1);
      const fresh = puffs.every((p) => p.age === Infinity);
      for (const p of puffs) {
        p.age += dt;
        const ox = p.x - camera.position.x, oz = p.z - camera.position.z;
        const away = Math.hypot(ox, oz);
        // Behind the eye past its crossing, or left behind, or at the end of its life: reborn ahead.
        const behind = ox * forward.x + oz * forward.z < -NEAR_MIST_CROSS_M;
        if (p.age >= p.life || away > NEAR_MIST_LEAVE || behind) born(p, camera, fresh);
        p.x += p.dx * dt;
        p.y += p.dy * dt;
        p.z += p.dz * dt;
        p.mesh.position.set(p.x, p.y, p.z);
        p.mesh.scaling.setAll(p.size);
        const edge = Math.min(1, p.age / NEAR_MIST_EDGE_S, (p.life - p.age) / NEAR_MIST_EDGE_S);
        const cross = Math.min(1, Math.hypot(p.x - camera.position.x, p.z - camera.position.z) / NEAR_MIST_CROSS_M);
        const breath = 0.85 + 0.15 * Math.sin(seconds * 0.7 + p.phase);
        p.mesh.visibility = Math.min(1, density * p.weight * Math.max(0, edge) * cross * breath);
        p.mesh.setEnabled(true);
      }
    },
    hold(density) {
      held = density === null ? null : clamp01(density);
    },
    density() {
      return drawn;
    },
    dispose() {
      for (const p of puffs) p.mesh.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
