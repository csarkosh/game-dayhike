/**
 * The lake's dragonflies as shapes and lists, with no engine: a kind's card
 * built in code, the colourways an individual can wear, the wingbeat's
 * numbers, and each kind's units a frame as instances (a matrix, the wing's
 * phase and amplitude, a colourway). `dragonflyBehaviour.ts` decides where
 * every unit is; `lite/dragonflyMeshes.ts` draws these.
 */
import { hash3 } from "@csarkosh/engine/sim/field";
import type { Dragonflies } from "./dragonflyBehaviour.js";
import { composeInto, quatFromEuler, type Quat } from "@csarkosh/engine/game/instancePose";
import { WING_TIME_WRAP } from "@csarkosh/engine/game/wingParams";

/** Body length (m) by kind: darner, skimmer, damselfly. */
export const DRAGONFLY_LENGTH: readonly [number, number, number] = [0.07, 0.045, 0.03];
/** How much larger than life every card is drawn, in its instance's matrix: at their real
 * lengths the dragonflies are specks a few metres out, and at half again those lengths a
 * skimmer 5 m off was still only some 12 pixels and a darner on its beat 12 m off 8. */
export const DRAGONFLY_DRAWN_SCALE = 3;
/** The wingbeat shown (Hz) by kind. */
export const DRAGONFLY_WING_HZ: readonly [number, number, number] = [36, 30, 18];
/** ω by kind (rad/s): 2π·Hz, written as 2π·n / WING_TIME_WRAP with n whole so the shader's time wrap
 * is phase-continuous (`lite/wingPlugin.ts`'s rule). */
export const DRAGONFLY_OMEGA: readonly [number, number, number] = [
  (2 * Math.PI * 10800) / WING_TIME_WRAP, // 36 Hz
  (2 * Math.PI * 9000) / WING_TIME_WRAP, // 30 Hz
  (2 * Math.PI * 5400) / WING_TIME_WRAP, // 18 Hz
];
/** A flying wing's amplitude (rad): a fast, small flap that reads as a shimmer. Perched, 0. */
export const DRAGONFLY_WING_AMP = 0.5;
/** The wings' alpha: a translucent membrane, so the beat reads as a blur rather than a flap. */
export const DRAGONFLY_WING_ALPHA = 0.4;
/**
 * The colourways each kind can wear (linear RGB), drawn per individual from its id. Each is a tint
 * over the pattern `dragonflyGeometry` bakes into the vertex colours, as the butterfly's are:
 * darners blue, green or brown (blue and green on brown across a shore); skimmers the four-spotted
 * skimmer's brown or a meadowhawk's red-brown; damselflies a bluet's blue or a forktail's teal.
 * Brighter than the real insects' by 1.3 in every channel, so each keeps its hue and saturation
 * and reads at a distance.
 */
export const DRAGONFLY_COLOURS: readonly (readonly [number, number, number])[][] = [
  [[0.078, 0.338, 0.676], [0.182, 0.52, 0.208], [0.39, 0.26, 0.13]],
  [[0.52, 0.299, 0.104], [0.676, 0.182, 0.065]],
  [[0.104, 0.364, 0.936], [0.065, 0.442, 0.546]],
];

/** The kinds' names, by kind. */
export const DRAGONFLY_KINDS = ["darner", "skimmer", "damselfly"] as const;
/** Half the body's width at the head end, as a share of the length; the tail end is half of it. */
const BODY_HALF: readonly [number, number, number] = [0.06, 0.1, 0.04];
/** A wing's reach, hinge to tip, as a share of the length. */
const WING_REACH: readonly [number, number, number] = [0.7, 0.75, 0.55];
/** A wing's chord at its hinge, as a share of the length; at the tip, `WING_TIP` of it. */
const WING_CHORD: readonly [number, number, number] = [0.17, 0.2, 0.1];
const WING_TIP = 0.7;
/**
 * The angle from the body's tail-ward axis out to each wing (rad). The darner's and the skimmer's
 * stand square to the body and lie flat, as a perched skimmer's do; the damselfly's sweep back
 * along its abdomen, folded as a perched damselfly holds them. The beat rotates every wing about
 * the body's axis, so in flight the folded pair shimmers about the abdomen.
 */
const WING_SWEEP: readonly [number, number, number] = [Math.PI / 2, Math.PI / 2, 0.25];
/** Where the fore- and hindwings hinge, as a share of the length forward of the middle. */
const FORE_HINGE = 0.22, HIND_HINGE = 0.08;
/** The pattern, colourless, multiplied by the colourway: the thorax darker than the abdomen, the
 * wings pale, and a skimmer's dark spot at each wing's leading tip. */
const THORAX_SHADE = 0.55, ABDOMEN_SHADE = 1, WING_SHADE = 0.9, SPOT_SHADE = 0.15;

/** Instances a kind's first allocation covers, then doubling. */
const MIN_INSTANCES = 16;
const EMPTY_BUFFER = new Float32Array(0);
/** The dragonflies' roughness. */
export const DRAGONFLY_ROUGHNESS = 0.5;
/** Salts for the per-individual wing phase and colourway, beside `dragonflyBehaviour.ts`'s in 70–79.
 * Apart, so an individual's colour and the beat of its wings are independent. */
const SALT_WING_PHASE = 75;
const SALT_COLOURWAY = 76;

/**
 * A kind's geometry, built in code: a body of two crossed quads (one upright, one flat) running the
 * kind's length along +z (head forward), and four wing quads hinged beside it, flat in the XZ plane,
 * the right pair at +x and the left at −x, so `lite/wingPlugin.ts` rotates each about the body's axis by
 * `|x| / halfSpan` while the upright body quad, at x = 0, holds still. 24 vertices, 12 triangles.
 */
export function dragonflyGeometry(kind: number): {
  positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array;
} {
  const k = kind === 1 || kind === 2 ? kind : 0;
  const len = DRAGONFLY_LENGTH[k];
  const half = len / 2;
  const w = BODY_HALF[k] * len;
  const reach = WING_REACH[k] * len;
  const chord = WING_CHORD[k] * len;
  const sweep = WING_SWEEP[k];
  const positions = new Float32Array(24 * 3);
  const normals = new Float32Array(24 * 3);
  const colors = new Float32Array(24 * 4);
  let v = 0;
  const put = (x: number, y: number, z: number, nx: number, ny: number, shade: number, alpha: number): void => {
    positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
    normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = 0;
    colors[v * 4] = shade; colors[v * 4 + 1] = shade; colors[v * 4 + 2] = shade; colors[v * 4 + 3] = alpha;
    v++;
  };
  // The body: upright (head-top, tail-top, tail-bottom, head-bottom), then flat (head-right,
  // tail-right, tail-left, head-left), tapering to half its width at the tail.
  put(0, w, half, 1, 0, THORAX_SHADE, 1);
  put(0, w / 2, -half, 1, 0, ABDOMEN_SHADE, 1);
  put(0, -w / 2, -half, 1, 0, ABDOMEN_SHADE, 1);
  put(0, -w, half, 1, 0, THORAX_SHADE, 1);
  put(w, 0, half, 0, 1, THORAX_SHADE, 1);
  put(w / 2, 0, -half, 0, 1, ABDOMEN_SHADE, 1);
  put(-w / 2, 0, -half, 0, 1, ABDOMEN_SHADE, 1);
  put(-w, 0, half, 0, 1, THORAX_SHADE, 1);
  // The wings: right fore, right hind, left fore, left hind; each hinge-front, tip-front, tip-back,
  // hinge-back. `a` runs out along the wing, `p` across it toward its leading edge; the hinge stands
  // off the body far enough that every vertex of a wing stays on its own side of x = 0.
  const ax = Math.sin(sweep), az = -Math.cos(sweep);
  const px = Math.cos(sweep), pz = Math.sin(sweep);
  const c = chord / 2, ct = c * WING_TIP;
  const spot = k === 1 ? SPOT_SHADE : WING_SHADE;
  for (const side of [1, -1]) {
    for (const hingeZ of [FORE_HINGE * len, HIND_HINGE * len]) {
      const hx = w + c * Math.abs(px);
      put(side * (hx + px * c), 0, hingeZ + pz * c, 0, 1, WING_SHADE, DRAGONFLY_WING_ALPHA);
      put(side * (hx + ax * reach + px * ct), 0, hingeZ + az * reach + pz * ct, 0, 1, spot, DRAGONFLY_WING_ALPHA);
      put(side * (hx + ax * reach - px * ct), 0, hingeZ + az * reach - pz * ct, 0, 1, WING_SHADE, DRAGONFLY_WING_ALPHA);
      put(side * (hx - px * c), 0, hingeZ - pz * c, 0, 1, WING_SHADE, DRAGONFLY_WING_ALPHA);
    }
  }
  const indices = new Uint16Array(36);
  for (let q = 0; q < 6; q++) {
    const b = q * 4;
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
  }
  return { positions, normals, colors, indices };
}

/** One kind's units a frame, as instances: reused, doubling buffers (the bird bucket's shape, `wildlifeScene.ts`). */
export type DragonflyList = {
  /** Matrix data; capacity is `matrices.length / 16`. */
  matrices: Float32Array;
  /** Per-instance (phase, amp), stride 2, in lockstep with `matrices`. */
  wing: Float32Array;
  /** Per-instance RGBA colourway, stride 4, alpha always 1: the surface's alpha is the vertex's times this one, so 1
   * keeps the body opaque and the wings at their own. */
  tint: Float32Array;
  /** Which of the kind's colourways each instance wears, by its place in `DRAGONFLY_COLOURS`. */
  way: Uint8Array;
  /** Units this frame. */
  count: number;
  /** Whether the last fill made the buffers again, larger: they are then handed over whole. */
  grown: boolean;
};

/** A kind's list holding nothing. */
export function emptyDragonflyList(): DragonflyList {
  return { matrices: EMPTY_BUFFER, wing: EMPTY_BUFFER, tint: EMPTY_BUFFER, way: new Uint8Array(0), count: 0, grown: false };
}

const scratchQ: Quat = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Fills `list` with kind `k`'s units of `d`: each drawn `DRAGONFLY_DRAWN_SCALE`
 * times its size, turned by its yaw and its pitch, at its place; its wing's
 * phase and its colourway drawn from its own id and the world's `seed`, so
 * the same dragonfly keeps both from frame to frame; a perched one's wings
 * still. The buffers grow together by doubling, their old contents dropped:
 * every unit is written again.
 */
export function fillDragonflyList(list: DragonflyList, d: Dragonflies, k: number, seed: number): DragonflyList {
  const poses = d.poses[k] ?? [];
  const n = Math.min(d.count[k] ?? 0, poses.length);
  list.count = n;
  const needed = n * 16;
  if (list.matrices.length >= needed) {
    list.grown = false;
  } else {
    let capacity = Math.max(list.matrices.length, MIN_INSTANCES * 16);
    while (capacity < needed) capacity *= 2;
    list.matrices = new Float32Array(capacity);
    list.wing = new Float32Array((capacity / 16) * 2);
    list.tint = new Float32Array((capacity / 16) * 4);
    list.way = new Uint8Array(capacity / 16);
    list.grown = true;
  }
  const colourways = DRAGONFLY_COLOURS[k] ?? [];
  for (let i = 0; i < n; i++) {
    const p = poses[i]!;
    quatFromEuler(-p.pitch, p.yaw, 0, scratchQ);
    composeInto(list.matrices, i * 16, DRAGONFLY_DRAWN_SCALE, DRAGONFLY_DRAWN_SCALE, DRAGONFLY_DRAWN_SCALE, scratchQ, p.x, p.y, p.z);
    // Drawn from the individual's id, not its slot: the slot is wherever the range and the
    // presence left it this frame, the id is the same dragonfly every frame.
    list.wing[i * 2] = hash3(p.id, 0, SALT_WING_PHASE, seed) * 2 * Math.PI;
    list.wing[i * 2 + 1] = p.perched ? 0 : DRAGONFLY_WING_AMP;
    const way = Math.floor(hash3(p.id, 0, SALT_COLOURWAY, seed) * colourways.length);
    const colour = colourways[way]!;
    list.way[i] = way;
    // Indexed, not destructured: destructuring makes an iterator per instance per frame.
    list.tint[i * 4] = colour[0]; list.tint[i * 4 + 1] = colour[1]; list.tint[i * 4 + 2] = colour[2]; list.tint[i * 4 + 3] = 1;
  }
  return list;
}

/** Half a kind's wingspan (m): the farthest a vertex of its card stands from the body's axis. */
export function dragonflyHalfSpan(positions: Float32Array): number {
  let halfSpan = 0;
  for (let i = 0; i < positions.length; i += 3) halfSpan = Math.max(halfSpan, Math.abs(positions[i]!));
  return halfSpan;
}
