/**
 * The night's mist (docs/gameplay/2026-10-06-the-mist-shades.md §1): a
 * thick cloud resting on the ground round the player all night, the ground
 * the shades stand against, deeper while the haunt is on and deeper still
 * in the chase. Not a wall at the eye: puffs seated on the terrain at the
 * player's sides and ahead, each its own size, wider than tall, drifting on
 * its own, breathing on its own, born and gone on its own clock, left
 * behind as the player walks and reborn ahead. Lit from within and outside
 * the scene's fog, so it keeps its grey against the dark, as the fog of
 * Silent Hill does; the figures are darker than it.
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
import { mistAlphaMap, MIST_TEX_SIZE } from "./mistField.js";

/** How many puffs, how far from the eye they are born (least and most), and beyond what they are left behind. */
export const HAUNT_MIST_PUFFS = 28;
export const HAUNT_MIST_BORN: readonly [number, number] = [2, 14];
export const HAUNT_MIST_LEAVE = 22;
/** A puff's size, its life, its drift (m/s) and how far above the ground its centre sits, as a share of its size. */
export const HAUNT_MIST_SIZE: readonly [number, number] = [8, 18];
export const HAUNT_MIST_LIFE_S: readonly [number, number] = [10, 24];
export const HAUNT_MIST_DRIFT = 0.35;
export const HAUNT_MIST_SEAT = 0.1;
/** A puff is wider than it is tall: the mist lies on the ground, not in the air. */
export const HAUNT_MIST_WIDE = 2;
export const HAUNT_MIST_TALL = 0.6;
/** Seconds a puff takes to come in and to go. */
export const HAUNT_MIST_EDGE_S = 2.5;
/** The puffs' grey (#3d3d3d), lit from within, and a puff's opacity at a full haunt. */
export const HAUNT_MIST_GREY = "#3d3d3d";
export const HAUNT_MIST_ALPHA = 0.85;
/** The mist's share at night with no haunt on: the cloud is there all night; the haunt deepens it. */
export const HAUNT_MIST_NIGHT_SHARE = 0.7;
/** In the chase: where the puffs are born instead, how much more opaque they are, and how much larger. */
export const HAUNT_MIST_BORN_CHASE: readonly [number, number] = [2.5, 10];
export const HAUNT_MIST_CHASE_ALPHA = 0.6;
export const HAUNT_MIST_CHASE_SIZE = 0.3;

type Puff = { mesh: Mesh; x: number; z: number; size: number; life: number; age: number; weight: number; phase: number; dx: number; dz: number };

export type HauntMist = {
  /** One frame: the haunt's level (escalation.ts), the night (0 to 1), the clock, and how far in the chase is (its cast, 0 to 1): the mist closes in and thickens with it. */
  update(camera: Camera, haunt: number, night: number, seconds: number, press?: number): void;
  dispose(): void;
};

/** `groundY` is the terrain's height at a place; `random` draws the puffs' births. */
export function createHauntMist(scene: Scene, groundY: (x: number, z: number) => number, random: () => number = Math.random): HauntMist {
  const between = (band: readonly [number, number]): number => band[0] + random() * (band[1] - band[0]);
  const tex = RawTexture.CreateRGBATexture(mistAlphaMap(), MIST_TEX_SIZE, MIST_TEX_SIZE, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, Engine.TEXTURETYPE_UNSIGNED_BYTE);
  tex.hasAlpha = true;
  const mat = new StandardMaterial("mat_haunt_mist", scene);
  mat.disableLighting = true;
  mat.opacityTexture = tex;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.emissiveColor = Color3.FromHexString(HAUNT_MIST_GREY);
  mat.alpha = HAUNT_MIST_ALPHA;
  // Outside the scene's fog: the night's fog is darker than the cloud, and would swallow it.
  mat.fogEnabled = false;
  const puffs: Puff[] = [];
  for (let i = 0; i < HAUNT_MIST_PUFFS; i++) {
    const mesh = MeshBuilder.CreatePlane(`haunt_mist_${i}`, { size: 1 }, scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    mesh.isPickable = false;
    mesh.material = mat;
    mesh.setEnabled(false);
    puffs.push({ mesh, x: 0, z: 0, size: 1, life: 0, age: Infinity, weight: 1, phase: 0, dx: 0, dz: 0 });
  }
  let lastSeconds: number | null = null;

  /** A puff born round the eye: a drawn bearing and distance, size, life, weight and drift. */
  function born(p: Puff, cx: number, cz: number, stagger: boolean, press: number): void {
    const a = random() * Math.PI * 2;
    const r = between([
      HAUNT_MIST_BORN[0] + (HAUNT_MIST_BORN_CHASE[0] - HAUNT_MIST_BORN[0]) * press,
      HAUNT_MIST_BORN[1] + (HAUNT_MIST_BORN_CHASE[1] - HAUNT_MIST_BORN[1]) * press,
    ]);
    p.x = cx + Math.sin(a) * r;
    p.z = cz + Math.cos(a) * r;
    p.size = between(HAUNT_MIST_SIZE);
    p.life = between(HAUNT_MIST_LIFE_S);
    // The first births are staggered through their lives, so the mist is not one generation.
    p.age = stagger ? random() * p.life : 0;
    p.weight = 0.5 + random() * 0.5;
    p.phase = random() * Math.PI * 2;
    const d = random() * Math.PI * 2;
    p.dx = Math.sin(d) * HAUNT_MIST_DRIFT;
    p.dz = Math.cos(d) * HAUNT_MIST_DRIFT;
  }

  return {
    update(camera, haunt, night, seconds, press = 0) {
      const close = Math.max(0, Math.min(1, press));
      const deep = HAUNT_MIST_NIGHT_SHARE + (1 - HAUNT_MIST_NIGHT_SHARE) * Math.max(0, Math.min(1, haunt));
      const level = deep * Math.max(0, Math.min(1, night)) * (1 + HAUNT_MIST_CHASE_ALPHA * close);
      const dt = lastSeconds === null ? 0 : Math.max(0, Math.min(0.1, seconds - lastSeconds));
      lastSeconds = seconds;
      if (level <= 0.002) {
        for (const p of puffs) { p.mesh.setEnabled(false); p.age = Infinity; }
        return;
      }
      const cx = camera.position.x, cz = camera.position.z;
      const fresh = puffs.every((p) => p.age === Infinity);
      for (const p of puffs) {
        p.age += dt;
        const away = Math.hypot(p.x - cx, p.z - cz);
        if (p.age >= p.life || away > HAUNT_MIST_LEAVE) born(p, cx, cz, fresh, close);
        p.x += p.dx * dt;
        p.z += p.dz * dt;
        const size = p.size * (1 + HAUNT_MIST_CHASE_SIZE * close);
        p.mesh.position.set(p.x, groundY(p.x, p.z) + size * HAUNT_MIST_TALL * HAUNT_MIST_SEAT, p.z);
        p.mesh.scaling.set(size * HAUNT_MIST_WIDE, size * HAUNT_MIST_TALL, 1);
        // In and out over the edges of its life, breathing a little in between.
        const edge = Math.min(1, p.age / HAUNT_MIST_EDGE_S, (p.life - p.age) / HAUNT_MIST_EDGE_S);
        const breath = 0.8 + 0.2 * Math.sin(seconds * 0.5 + p.phase);
        p.mesh.visibility = Math.min(1, level * p.weight * Math.max(0, edge) * breath);
        p.mesh.setEnabled(true);
      }
    },
    dispose() {
      for (const p of puffs) p.mesh.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
