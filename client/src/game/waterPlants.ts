// client/src/game/waterPlants.ts
/**
 * A murky lake's plants: reeds and cattails on its wet band, its shallows and
 * its marsh; yellow pond-lilies on its 0.5 to 2 m water. The sim's clutter
 * field places them (`CLUTTER_REED`, `CLUTTER_LILY`, in the level id); this
 * builds their meshes in code and draws every plant a lake has, once, at load.
 * A lake is a few thousand square metres, so nothing follows the camera.
 */
// Side-effect import, load-bearing: `thinInstanceSetBuffer` and friends are
// patched onto `Mesh.prototype` by this module (the clutterMeshes.ts note).
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import {
  CLUTTER_LILY, CLUTTER_LILY_PATCH_WAVE, CLUTTER_LILY_SALT, CLUTTER_REED, clutterInRect, type ClutterInstance,
} from "../sim/clutter.js";
import { hash3 } from "../sim/field.js";
import { POND_SHORE } from "../sim/features.js";
import type { LakeSource } from "../sim/terrain.js";
import { BLADE_VERTS, bladeClumpGeometry, type BladeCharacter, type BladeClumpGeometry } from "./bladeClump.js";
import { attachFoliage, setFoliageEdges, FOLIAGE_PROFILES } from "./foliagePlugin.js";
import { attachFoliageLight } from "./foliageLightPlugin.js";
import type { Rgb } from "./colour.js";

/** The reed class's variants, by `ClutterInstance.variant`: two reeds and a
 * cattail. Their colours are their own (the material's albedo is white), and
 * their heights times the class's 0.9 to 1.1 scale stand 1.2 to 2 m. */
export const REED_CHARACTERS: readonly BladeCharacter[] = [
  { name: "reed", height: [1.35, 1.65], width: 0.007, droop: [0.05, 0.25], tint: { r: 0.3, g: 0.34, b: 0.14 }, tip: "none" },
  { name: "tall reed", height: [1.5, 1.8], width: 0.009, droop: [0.1, 0.35], tint: { r: 0.36, g: 0.36, b: 0.17 }, tip: "none" },
  { name: "cattail", height: [1.35, 1.8], width: 0.006, droop: [0, 0.08], tint: { r: 0.27, g: 0.32, b: 0.13 }, tip: "none" },
];
/** Blades in each variant's clump. */
export const REED_BLADES: readonly number[] = [14, 12, 5];
/** A cattail's head: a brown spike this long and this thick (m), centred this
 * far up its stalk. */
export const CATTAIL_HEAD_LENGTH = 0.2;
export const CATTAIL_HEAD_RADIUS = 0.014;
export const CATTAIL_HEAD_AT = 0.82;
const CATTAIL_HEAD_SIDES = 6;
/** Two rings of sides, then the two caps' centres. */
const CATTAIL_HEAD_VERTS = CATTAIL_HEAD_SIDES * 2 + 2;
const CATTAIL_HEAD_COLOUR: Rgb = { r: 0.33, g: 0.21, b: 0.12 };
/** Lily pads float this far above the lake's level (m), over the water's own
 * surface at +0.02, with the depth bias a painted face needs at a distance
 * (the decal note in `boardPaint.ts`). */
export const LILY_LIFT = 0.03;
const LILY_DEPTH_BIAS = -120;
const LILY_PAD_SEGMENTS = 14;
/** Half the pad's notch (rad). */
const LILY_NOTCH = 0.25;
const LILY_PAD_COLOUR: Rgb = { r: 0.16, g: 0.26, b: 0.08 };
const LILY_FLOWER_COLOUR: Rgb = { r: 0.85, g: 0.7, b: 0.12 };
/** About a third of the lily patches flower (research §5.1), and in a
 * flowering patch this share of the pads. */
export const LILY_FLOWER_PATCHES = 1 / 3;
export const LILY_FLOWER_SHARE = 0.25;
const LILY_FLOWER_PETALS = 6;
const LILY_FLOWER_RADIUS = 0.022;
const LILY_FLOWER_HEIGHT = 0.025;
/** The reeds stop moving in the wind between these distances (m). */
const REED_WIND_EDGES: readonly [number, number] = [60, 90];

type Geometry = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array };

/** A reed clump by variant: the blade builder's strips, and on the cattail a
 * brown head below every stalk's tip. */
export function reedGeometry(variant: number): Geometry {
  const count = REED_BLADES[variant] as number;
  const g = bladeClumpGeometry(REED_CHARACTERS[variant] as BladeCharacter, count);
  return variant === 2 ? withCattailHeads(g, count) : g;
}

function withCattailHeads(g: BladeClumpGeometry, stalks: number): Geometry {
  const stride = g.colors.length / (g.positions.length / 3);
  const n0 = g.positions.length / 3;
  const n = n0 + stalks * CATTAIL_HEAD_VERTS;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const colors = new Float32Array(n * stride);
  const indices = new Uint16Array(g.indices.length + stalks * CATTAIL_HEAD_SIDES * 12);
  positions.set(g.positions);
  normals.set(g.normals);
  colors.set(g.colors);
  indices.set(g.indices);
  let v = n0;
  let t = g.indices.length;
  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number): void => {
    positions.set([x, y, z], v * 3);
    normals.set([nx, ny, nz], v * 3);
    colors.set([CATTAIL_HEAD_COLOUR.r, CATTAIL_HEAD_COLOUR.g, CATTAIL_HEAD_COLOUR.b, 1].slice(0, stride), v * stride);
    v++;
  };
  for (let b = 0; b < stalks; b++) {
    // Each blade's strip ends in its tip vertex; its root lies at y = 0.
    const tip = b * BLADE_VERTS + BLADE_VERTS - 1;
    const rootX = g.blade[tip * 4] as number;
    const rootZ = g.blade[tip * 4 + 1] as number;
    const cx = rootX + ((g.positions[tip * 3] as number) - rootX) * CATTAIL_HEAD_AT;
    const cy = (g.positions[tip * 3 + 1] as number) * CATTAIL_HEAD_AT;
    const cz = rootZ + ((g.positions[tip * 3 + 2] as number) - rootZ) * CATTAIL_HEAD_AT;
    const first = v;
    for (let ring = 0; ring < 2; ring++) {
      const y = cy + (ring - 0.5) * CATTAIL_HEAD_LENGTH;
      for (let k = 0; k < CATTAIL_HEAD_SIDES; k++) {
        const a = (k / CATTAIL_HEAD_SIDES) * Math.PI * 2;
        vertex(cx + Math.cos(a) * CATTAIL_HEAD_RADIUS, y, cz + Math.sin(a) * CATTAIL_HEAD_RADIUS, Math.cos(a), 0, Math.sin(a));
      }
    }
    const bottom = v;
    vertex(cx, cy - 0.5 * CATTAIL_HEAD_LENGTH, cz, 0, -1, 0);
    const top = v;
    vertex(cx, cy + 0.5 * CATTAIL_HEAD_LENGTH, cz, 0, 1, 0);
    for (let k = 0; k < CATTAIL_HEAD_SIDES; k++) {
      const a0 = first + k;
      const a1 = first + ((k + 1) % CATTAIL_HEAD_SIDES);
      const b0 = a0 + CATTAIL_HEAD_SIDES;
      const b1 = a1 + CATTAIL_HEAD_SIDES;
      indices.set([a0, b0, a1, a1, b0, b1, bottom, a1, a0, top, b0, b1], t);
      t += 12;
    }
  }
  return { positions, normals, colors, indices };
}

/** A pad: a disc of unit radius lying flat, with its notch along +x. */
export function lilyPadGeometry(): Geometry {
  const rim = LILY_PAD_SEGMENTS + 1;
  const positions = new Float32Array((rim + 1) * 3);
  const normals = new Float32Array((rim + 1) * 3);
  const colors = new Float32Array((rim + 1) * 4).fill(1);
  const indices = new Uint16Array(LILY_PAD_SEGMENTS * 3);
  normals[1] = 1;
  for (let k = 0; k < rim; k++) {
    const a = LILY_NOTCH + (k / LILY_PAD_SEGMENTS) * (Math.PI * 2 - 2 * LILY_NOTCH);
    positions.set([Math.cos(a), 0, Math.sin(a)], (k + 1) * 3);
    normals.set([0, 1, 0], (k + 1) * 3);
  }
  for (let k = 0; k < LILY_PAD_SEGMENTS; k++) indices.set([0, k + 2, k + 1], k * 3);
  return { positions, normals, colors, indices };
}

/** A flower: a cup of petals opening up from the pad's centre. */
export function lilyFlowerGeometry(): Geometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const w = Math.PI / LILY_FLOWER_PETALS;
  for (let p = 0; p < LILY_FLOWER_PETALS; p++) {
    const a = (p / LILY_FLOWER_PETALS) * Math.PI * 2;
    const base = positions.length / 3;
    positions.push(
      0, 0, 0,
      Math.cos(a - w) * LILY_FLOWER_RADIUS, LILY_FLOWER_HEIGHT, Math.sin(a - w) * LILY_FLOWER_RADIUS,
      Math.cos(a + w) * LILY_FLOWER_RADIUS, LILY_FLOWER_HEIGHT, Math.sin(a + w) * LILY_FLOWER_RADIUS,
    );
    for (let k = 0; k < 3; k++) normals.push(Math.cos(a) * 0.6, 0.8, Math.sin(a) * 0.6);
    indices.push(base, base + 1, base + 2);
  }
  const count = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(count * 4).fill(1),
    indices: new Uint16Array(indices),
  };
}

/** Whether a pad carries a flower: a third of the patches flower (seeded by
 * the patch's cell), and a share of the pads in each. */
export function lilyFlowers(seed: number, inst: ClutterInstance): boolean {
  const px = Math.floor(inst.x / CLUTTER_LILY_PATCH_WAVE);
  const pz = Math.floor(inst.z / CLUTTER_LILY_PATCH_WAVE);
  if (hash3(px, pz, 9, seed ^ CLUTTER_LILY_SALT) >= LILY_FLOWER_PATCHES) return false;
  return inst.hash < LILY_FLOWER_SHARE;
}

export type WaterPlants = { meshes: Mesh[]; dispose(): void };

function meshFrom(scene: Scene, name: string, g: Geometry): Mesh {
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = g.positions;
  data.normals = g.normals;
  data.colors = g.colors;
  data.indices = g.indices;
  data.applyToMesh(mesh, false);
  mesh.isPickable = false;
  return mesh;
}

function material(scene: Scene, name: string, albedo: Rgb, roughness: number): PBRMaterial {
  const mat = new PBRMaterial(name, scene);
  mat.albedoColor = new Color3(albedo.r, albedo.g, albedo.b);
  mat.metallic = 0;
  mat.roughness = roughness;
  mat.backFaceCulling = false;
  return mat;
}

/** A lily's yaw comes from its own hash channel, not `inst.hash` (which picks
 * the flowering pads): a cell this many to the metre, finer than the class's
 * cell so no two pads share one, and this channel of `hash3`. */
const LILY_YAW_CELLS = 7;
const LILY_YAW_CHANNEL = 11;

/** A lily pad's (and its flower's) yaw, rad: a pure function of the instance
 * and the seed, apart from the hash that decides whether it flowers, so the
 * flowering pads' notches point every way. */
export function lilyYaw(seed: number, inst: ClutterInstance): number {
  return hash3(Math.floor(inst.x * LILY_YAW_CELLS), Math.floor(inst.z * LILY_YAW_CELLS), LILY_YAW_CHANNEL, seed ^ CLUTTER_LILY_SALT) * Math.PI * 2;
}

/** Every plant `list` holds, as thin instances: at the yaw `yaw` gives, scaled
 * (sx, sy, sx), at the height `y` gives. A mesh with none is disabled. */
function place(mesh: Mesh, list: readonly ClutterInstance[], yaw: (inst: ClutterInstance) => number, y: (inst: ClutterInstance) => number, sx: (inst: ClutterInstance) => number, sy: (inst: ClutterInstance) => number): void {
  if (list.length === 0) {
    mesh.setEnabled(false);
    return;
  }
  const buf = new Float32Array(list.length * 16);
  const m = new Matrix();
  const rot = new Quaternion();
  const scale = new Vector3();
  const at = new Vector3();
  list.forEach((inst, i) => {
    Quaternion.RotationYawPitchRollToRef(yaw(inst), 0, 0, rot);
    scale.set(sx(inst), sy(inst), sx(inst));
    at.set(inst.x, y(inst), inst.z);
    Matrix.ComposeToRef(scale, rot, at, m);
    m.copyToArray(buf, i * 16);
  });
  mesh.thinInstanceSetBuffer("matrix", buf, 16, true);
  mesh.thinInstanceRefreshBoundingInfo(false);
}

export function createWaterPlants(scene: Scene, seed: number, lakes: readonly LakeSource[]): WaterPlants {
  const reeds: ClutterInstance[][] = [[], [], []];
  const pads: ClutterInstance[] = [];
  const levelOf = new Map<ClutterInstance, number>();
  for (const lake of lakes) {
    const r = lake.radius + POND_SHORE + 1;
    for (const inst of clutterInRect(seed, CLUTTER_REED, lake.x - r, lake.z - r, lake.x + r, lake.z + r)) {
      (reeds[inst.variant] as ClutterInstance[]).push(inst);
    }
    for (const inst of clutterInRect(seed, CLUTTER_LILY, lake.x - r, lake.z - r, lake.x + r, lake.z + r)) {
      pads.push(inst);
      levelOf.set(inst, lake.level);
    }
  }
  const meshes: Mesh[] = [];
  const materials: PBRMaterial[] = [];
  for (let variant = 0; variant < REED_CHARACTERS.length; variant++) {
    const mesh = meshFrom(scene, `water_reeds_${variant}`, reedGeometry(variant));
    const mat = material(scene, `water_reeds_${variant}_mat`, { r: 1, g: 1, b: 1 }, 0.8);
    attachFoliage(mat, FOLIAGE_PROFILES.REEDS, mesh.getBoundingInfo().boundingBox.maximum.y);
    attachFoliageLight(mat);
    setFoliageEdges(mat, REED_WIND_EDGES);
    mesh.material = mat;
    mesh.receiveShadows = true;
    place(mesh, reeds[variant] as ClutterInstance[], (i) => i.hash * Math.PI * 2, (i) => i.groundH, (i) => i.scale, (i) => i.scale);
    meshes.push(mesh);
    materials.push(mat);
  }
  const padMesh = meshFrom(scene, "water_lily_pads", lilyPadGeometry());
  const padMat = material(scene, "water_lily_pads_mat", LILY_PAD_COLOUR, 0.35);
  padMat.zOffsetUnits = LILY_DEPTH_BIAS;
  padMesh.material = padMat;
  const lifted = (i: ClutterInstance): number => (levelOf.get(i) as number) + LILY_LIFT;
  const padYaw = (i: ClutterInstance): number => lilyYaw(seed, i);
  place(padMesh, pads, padYaw, lifted, (i) => i.scale, () => 1);
  const flowerMesh = meshFrom(scene, "water_lily_flowers", lilyFlowerGeometry());
  const flowerMat = material(scene, "water_lily_flowers_mat", LILY_FLOWER_COLOUR, 0.6);
  flowerMat.zOffsetUnits = LILY_DEPTH_BIAS;
  flowerMesh.material = flowerMat;
  place(flowerMesh, pads.filter((i) => lilyFlowers(seed, i)), padYaw, lifted, () => 1, () => 1);
  meshes.push(padMesh, flowerMesh);
  materials.push(padMat, flowerMat);
  return {
    meshes,
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const mat of materials) mat.dispose();
    },
  };
}
