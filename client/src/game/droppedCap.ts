/**
 * The dropped cap (docs/gameplay/2026-10-07-the-inner-voice.md): the missing
 * hiker's cap, lying beside the trail a fifth of the way up, the one thing
 * of theirs the ranger finds before the crest. A small shape, a crown and a
 * brim, in a red nothing else on the ground wears, seated on the terrain a
 * stride off the path on the side the seed draws. The inner voice speaks
 * when the player comes within CAP_NEAR_M of it.
 *
 * Here is the cap with no engine: where it lies, how it is seated and
 * tipped, and its shape as vertices, the crown a flattened half sphere and
 * the brim a squat cylinder pushed forward and stretched, the two as one
 * mesh in the cap's own frame. The half sphere and the cylinder are Babylon.js's own
 * (`CreateSphereVertexData`, `CreateCylinderVertexData`), vertex for vertex.
 */
import { hash2 } from "../sim/field.js";
import type { TrailGraph } from "../sim/trail.js";
import { stemPointAt } from "../sim/trailRoute.js";
import { composeInto, quatFromEuler, type Quat } from "./instancePose.js";

/** How far up the stem the cap lies (0 the pad, 1 the crest), how far off the path, and how near the player must come to it. */
export const CAP_PROGRESS = 0.2;
export const CAP_SIDE_M = 1.6;
export const CAP_NEAR_M = 3.5;
/** The cap's size, metres, its colour and its roughness. */
export const CAP_RADIUS = 0.11;
export const CAP_COLOUR = { r: 0.55, g: 0.06, b: 0.05 };
export const CAP_ROUGHNESS = 0.9;

/** The crown: a half sphere of this many segments, flattened to this share of its height. */
export const CAP_CROWN = { diameter: CAP_RADIUS * 2, segments: 10, slice: 0.5, scaleY: 0.75 } as const;
/** The brim: a cylinder, pushed forward along the cap's z and stretched. */
export const CAP_BRIM = {
  diameter: CAP_RADIUS * 2.1, height: CAP_RADIUS * 0.12, tessellation: 16,
  position: { x: 0, y: 0, z: CAP_RADIUS * 0.55 }, scaling: { x: 0.8, y: 1, z: 1.1 },
} as const;
/** How far over the ground the cap's frame is seated, and how it is tipped, as a dropped thing lies (radians about x and z). */
export const CAP_LIFT = CAP_RADIUS * 0.12;
export const CAP_TIP = { x: 0.18, z: 0.12 } as const;

export type DroppedCap = { x: number; z: number; yaw: number };

/** Where the cap lies for a trail and a seed: beside the stem at CAP_PROGRESS, on the seed's side, or null without a stem. */
export function droppedCapAt(graph: TrailGraph, seed: number): DroppedCap | null {
  const at = stemPointAt(graph, CAP_PROGRESS);
  if (at === null) return null;
  const side = hash2(7, 11, seed) < 0.5 ? 1 : -1;
  // Perpendicular to the stem's direction: a stride off the path.
  return { x: at.x - at.dz * CAP_SIDE_M * side, z: at.z + at.dx * CAP_SIDE_M * side, yaw: hash2(13, 17, seed) * 6.2832 };
}

/** The cap's frame on ground at `groundY`: where it stands and how it is turned (Euler angles, about z, then x, then y). */
export function capSeat(cap: DroppedCap, groundY: number): { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } } {
  return { position: { x: cap.x, y: groundY + CAP_LIFT, z: cap.z }, rotation: { x: CAP_TIP.x, y: cap.yaw, z: CAP_TIP.z } };
}

/** The matrix of the cap's frame on ground at `groundY`: sixteen floats, as a shader reads them. */
export function capSeatMatrix(cap: DroppedCap, groundY: number): Float32Array {
  const seat = capSeat(cap, groundY);
  const turn: Quat = quatFromEuler(seat.rotation.x, seat.rotation.y, seat.rotation.z, { x: 0, y: 0, z: 0, w: 1 });
  const out = new Float32Array(16);
  composeInto(out, 0, 1, 1, 1, turn, seat.position.x, seat.position.y, seat.position.z);
  return out;
}

/** A shape as vertices: xyz a vertex of position and of normal, three indices a triangle. */
export type CapGeometry = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };

/** A sphere's upper part, as Babylon.js builds one of `segments` cut at `slice` of its height (`CreateSphereVertexData`). */
export function slicedSphere(diameter: number, segments: number, slice: number): CapGeometry {
  const radius = diameter / 2;
  const zSteps = 2 + (segments | 0);
  const ySteps = 2 * zSteps;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let zStep = 0; zStep <= zSteps; zStep++) {
    const angleZ = (zStep / zSteps) * Math.PI * slice;
    // The up vector turned about z by -angleZ, then about y by angleY, by Babylon.js's rotation matrices, whose
    // entries are single floats.
    // (A sum with the matrix's zero entries makes a negative zero a zero, as there.)
    const ax = Math.fround(-Math.sin(-angleZ)) + 0;
    const ay = Math.fround(Math.cos(-angleZ)) + 0;
    for (let yStep = 0; yStep <= ySteps; yStep++) {
      const angleY = (yStep / ySteps) * Math.PI * 2;
      const x = ax * Math.fround(Math.cos(angleY)) + 0;
      const z = ax * Math.fround(-Math.sin(angleY)) + 0;
      positions.push(x * radius, ay * radius, z * radius);
      const nx = x / radius;
      const ny = ay / radius;
      const nz = z / radius;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (length === 0 || length === 1) normals.push(nx, ny, nz);
      else normals.push(nx * (1 / length), ny * (1 / length), nz * (1 / length));
    }
    if (zStep > 0) {
      const count = positions.length / 3;
      for (let first = count - 2 * (ySteps + 1); first + ySteps + 2 < count; first++) {
        indices.push(first, first + 1, first + ySteps + 1);
        indices.push(first + ySteps + 1, first + 1, first + ySteps + 2);
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

/** A capped cylinder of one diameter, as Babylon.js builds it (`CreateCylinderVertexData`, one subdivision). */
export function cappedCylinder(diameter: number, height: number, tessellation: number): CapGeometry {
  const radius = diameter / 2;
  const sides = tessellation | 0;
  const step = (Math.PI * 2) / sides;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= 1; i++) {
    for (let j = 0; j <= sides; j++) {
      const angle = j * step;
      const x = Math.cos(-angle) * radius;
      const z = Math.sin(-angle) * radius;
      positions.push(x, -height / 2 + i * height, z);
      // The wall's normal: level, since the cylinder does not taper.
      const ny = Math.sqrt(x * x + z * z) * 0;
      const length = Math.sqrt(x * x + ny * ny + z * z);
      if (length === 0 || length === 1) normals.push(x, ny, z);
      else normals.push(x * (1 / length), ny * (1 / length), z * (1 / length));
    }
  }
  for (let j = 0; j < sides; j++) {
    const i0 = j;
    const i1 = sides + 1 + j;
    const i2 = j + 1;
    const i3 = sides + 1 + j + 1;
    indices.push(i0, i1, i2);
    indices.push(i3, i2, i1);
  }
  for (const top of [false, true]) {
    const base = positions.length / 3;
    const offset = top ? height / 2 : -height / 2;
    positions.push(0, offset, 0);
    normals.push(0, top ? 1 : -1, 0);
    for (let i = 0; i <= sides; i++) {
      const angle = (Math.PI * 2 * i) / sides;
      positions.push(Math.cos(-angle) * radius, offset, Math.sin(-angle) * radius);
      normals.push(0, top ? 1 : -1, 0);
    }
    for (let i = 0; i < sides; i++) {
      if (top) indices.push(base, base + (i + 2), base + (i + 1));
      else indices.push(base, base + (i + 1), base + (i + 2));
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

/**
 * The cap's whole shape in its own frame: the crown flattened and the brim
 * pushed forward and stretched, one mesh. A normal is carried by a scale
 * as a surface's is, by the scale's inverse, and made a unit vector again.
 */
export function capGeometry(): CapGeometry {
  const crown = slicedSphere(CAP_CROWN.diameter, CAP_CROWN.segments, CAP_CROWN.slice);
  const brim = cappedCylinder(CAP_BRIM.diameter, CAP_BRIM.height, CAP_BRIM.tessellation);
  const parts = [
    { shape: crown, scale: { x: 1, y: CAP_CROWN.scaleY, z: 1 }, at: { x: 0, y: 0, z: 0 } },
    { shape: brim, scale: CAP_BRIM.scaling, at: CAP_BRIM.position },
  ];
  const vertices = parts.reduce((n, part) => n + part.shape.positions.length, 0);
  const positions = new Float32Array(vertices);
  const normals = new Float32Array(vertices);
  const indices = new Uint32Array(parts.reduce((n, part) => n + part.shape.indices.length, 0));
  let v = 0;
  let k = 0;
  for (const { shape, scale, at } of parts) {
    const first = v / 3;
    for (let i = 0; i < shape.positions.length; i += 3) {
      positions[v] = (shape.positions[i] as number) * scale.x + at.x;
      positions[v + 1] = (shape.positions[i + 1] as number) * scale.y + at.y;
      positions[v + 2] = (shape.positions[i + 2] as number) * scale.z + at.z;
      const nx = (shape.normals[i] as number) / scale.x;
      const ny = (shape.normals[i + 1] as number) / scale.y;
      const nz = (shape.normals[i + 2] as number) / scale.z;
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[v] = nx / length;
      normals[v + 1] = ny / length;
      normals[v + 2] = nz / length;
      v += 3;
    }
    for (let i = 0; i < shape.indices.length; i++) indices[k++] = (shape.indices[i] as number) + first;
  }
  return { positions, normals, indices };
}
