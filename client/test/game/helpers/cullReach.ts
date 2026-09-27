/**
 * Shared by the cull tests: how far a culled instance reaches from its
 * translation, and whether a point is in the true frustum of a rolled camera.
 */
import { expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLUTTER_CULLED } from "../../../src/game/clutterMeshes.js";
import { CLUTTER_GRASS, CLUTTER_GRASS_SCALE_MAX } from "../../../src/sim/clutter.js";
import { BLADE_CHARACTERS, BLADE_TIER_COUNTS, BLADE_SIZE_FACTOR, bladeClumpGeometry } from "../../../src/game/bladeClump.js";
import { WIND_FLUTTER_MAX, WIND_GUST_MAX, WIND_LEAN_MAX } from "../../../src/game/windParams.js";
import { FOLIAGE_BEND, FOLIAGE_TILT } from "../../../src/game/foliagePlugin.js";
import type { CullPose } from "../../../src/game/grassCull.js";

/**
 * How far any vertex of a culled instance can be drawn from its translation:
 * `horiz` sideways and `top` up, at the largest scale, with the wind's lean,
 * its peak gust (the gust field peaks at 1.5) and its flutter at speed 1, the
 * camera tilt and a player's bend added sideways. The foliage vertex stage
 * moves a vertex by at most its own drawn height times that wind fraction
 * (fH² × height ≤ the vertex's height).
 */
export const WIND_FRACTION = WIND_LEAN_MAX + 1.5 * WIND_GUST_MAX + WIND_FLUTTER_MAX * Math.hypot(0.75, 0.35);
export type Reach = { horiz: number; top: number };
export function reachOf(maxHoriz: number, maxY: number, scale: number): Reach {
  return { horiz: maxHoriz * scale + WIND_FRACTION * maxY * scale + FOLIAGE_TILT + FOLIAGE_BEND, top: maxY * scale };
}
/** A card model's reach, from the POSITION bounds of every mesh in its file. */
export function glbReach(file: string, scale: number): Reach {
  const buf = readFileSync(fileURLToPath(new URL(`../../../assets/models/${file}.glb`, import.meta.url)));
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString()) as {
    nodes: { translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { min: number[]; max: number[] }[];
  };
  // No node carries a transform, so the accessor bounds are the model's.
  for (const n of json.nodes) expect(n.translation ?? n.rotation ?? n.scale ?? n.matrix).toBeUndefined();
  let horiz = 0, top = 0;
  for (const m of json.meshes) for (const prim of m.primitives) {
    const a = json.accessors[prim.attributes.POSITION]!;
    for (const x of [a.min[0]!, a.max[0]!]) for (const z of [a.min[2]!, a.max[2]!]) horiz = Math.max(horiz, Math.hypot(x, z));
    top = Math.max(top, a.max[1]!);
  }
  return reachOf(horiz, top, scale);
}
/** The blade clumps' reach, over every character at the largest count any tier and size builds. */
export function bladeReach(): Reach {
  let horiz = 0, top = 0;
  for (let ch = 0; ch < BLADE_CHARACTERS.length; ch++) {
    for (const quality of ["high", "medium"] as const) {
      for (const base of BLADE_TIER_COUNTS[quality][ch]!) {
        for (const f of BLADE_SIZE_FACTOR) {
          const g = bladeClumpGeometry(BLADE_CHARACTERS[ch]!, Math.round(base * f));
          for (let v = 0; v < g.positions.length; v += 3) {
            horiz = Math.max(horiz, Math.hypot(g.positions[v]!, g.positions[v + 2]!));
            top = Math.max(top, g.positions[v + 1]!);
          }
        }
      }
    }
  }
  // Blade cells are drawn at scale 1, their height at most 1 (the strength and trample scales).
  return reachOf(horiz, top, 1);
}
/** The culled card classes and their models; a class added to CLUTTER_CULLED must be added here. */
export const CULLED_MODELS = new Map<number, { files: string[]; scaleMax: number }>([
  [CLUTTER_GRASS, { files: ["clutter.grass_a", "clutter.grass_b"], scaleMax: CLUTTER_GRASS_SCALE_MAX }],
]);
export function cardReach(): Reach {
  let horiz = 0, top = 0;
  for (const cls of CLUTTER_CULLED) {
    const entry = CULLED_MODELS.get(cls)!;
    for (const file of entry.files) {
      const r = glbReach(file, entry.scaleMax);
      horiz = Math.max(horiz, r.horiz);
      top = Math.max(top, r.top);
    }
  }
  return { horiz, top };
}

/** Whether a point is inside the true frustum of a camera with roll: yaw 0
 * faces +Z, positive pitch looks down, roll turns right and up about forward. */
export function seen(c: CullPose, px: number, py: number, pz: number): boolean {
  const dx = px - c.x, dy = py - c.y, dz = pz - c.z;
  const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), sp = Math.sin(c.pitch), cp = Math.cos(c.pitch);
  const fx = sy * cp, fy = -sp, fz = cy * cp;
  const r0x = cy, r0y = 0, r0z = -sy;
  const u0x = sy * sp, u0y = cp, u0z = cy * sp;
  const sr = Math.sin(c.roll), cr = Math.cos(c.roll);
  const rx = r0x * cr + u0x * sr, ry = r0y * cr + u0y * sr, rz = r0z * cr + u0z * sr;
  const ux = u0x * cr - r0x * sr, uy = u0y * cr - r0y * sr, uz = u0z * cr - r0z * sr;
  const depth = dx * fx + dy * fy + dz * fz;
  if (depth <= 0.05) return false;
  const ty = Math.tan(c.fov / 2), tx = ty * c.aspect;
  return Math.abs((dx * rx + dy * ry + dz * rz) / depth) <= tx && Math.abs((dx * ux + dy * uy + dz * uz) / depth) <= ty;
}


/** Whether any part of an instance rooted at (x, y, z) with `reach` is in the
 * rolled camera's view: its axis, root to top, and eight points around it at
 * its sideways reach, at the root and at the top. */
export function extentSeen(c: CullPose, x: number, y: number, z: number, reach: Reach): boolean {
  if (seen(c, x, y, z) || seen(c, x, y + reach.top, z)) return true;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const px = x + reach.horiz * Math.cos(a), pz = z + reach.horiz * Math.sin(a);
    if (seen(c, px, y, pz) || seen(c, px, y + reach.top, pz)) return true;
  }
  return false;
}

/** A walk for the shells: a cut at a random pose rolled by up to `maxRoll`
 * either way, then steps that stay under every threshold (turns of 0.95 of
 * `turn` on both axes at once, a roll of 0.95 of `roll`, moves under `move`)
 * and so must reuse that cut. */
export function thresholdWalk(
  base: CullPose, phases: number, seed: number, turn: number, move: number, roll: number, maxRoll: number,
): { cut: CullPose; views: CullPose[] }[] {
  let r = seed;
  const rand = (): number => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return r / 4294967296; };
  const sign = (): number => (rand() < 0.5 ? -1 : 1);
  const out: { cut: CullPose; views: CullPose[] }[] = [];
  for (let phase = 0; phase < phases; phase++) {
    const cut: CullPose = {
      ...base,
      x: base.x + (rand() - 0.5) * 2,
      z: base.z + (rand() - 0.5) * 2,
      yaw: (rand() - 0.5) * 2 * Math.PI,
      pitch: -0.8 + rand() * 2,
      roll: sign() * maxRoll,
      aspect: phase % 2 === 0 ? base.aspect : 16 / 9,
    };
    const views: CullPose[] = [];
    for (let k = 0; k < 4; k++) {
      const a = rand() * 2 * Math.PI, m = 0.95 * move * rand();
      views.push({
        ...cut,
        x: cut.x + m * Math.cos(a),
        z: cut.z + m * Math.sin(a),
        yaw: cut.yaw + sign() * 0.95 * turn,
        pitch: cut.pitch + sign() * 0.95 * turn,
        roll: cut.roll + sign() * 0.95 * roll,
      });
    }
    out.push({ cut, views });
  }
  return out;
}
