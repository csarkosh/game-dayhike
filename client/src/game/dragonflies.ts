/**
 * The Babylon shell for the lake's dragonflies: one thin-instance card mesh a kind (darner,
 * skimmer, damselfly), built in code as the butterfly is (`wildlifeMeshes.ts`), each with its own
 * `PBRMaterial` wearing the birds' wing beat (`wingPlugin.ts`). `dragonflyBehaviour.ts` decides
 * where every unit is; this file only writes their instances. One draw a kind; no shadows.
 *
 * The buffers follow the bird buckets: a matrix, a `wing` (phase, amp) and a `color` buffer per
 * kind, grown together by doubling and otherwise rewritten in place, so a steady frame uploads
 * the live prefix and allocates nothing.
 *
 * Renderer-only by design: nothing here may migrate into sim/.
 */
// Side-effect import, and it is load-bearing: `thinInstanceSetBuffer` and
// `thinInstanceCount` are added to `Mesh` only when this module is pulled in —
// the same note `wildlifeMeshes.ts` carries.
import "@babylonjs/core/Meshes/thinInstanceMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { hash3 } from "../sim/field.js";
import { attachWing, WING_TIME_WRAP } from "./wingPlugin.js";
import type { Dragonflies } from "./dragonflyBehaviour.js";

/** Body length (m) by kind: darner, skimmer, damselfly. */
export const DRAGONFLY_LENGTH: readonly [number, number, number] = [0.07, 0.045, 0.03];
/** The wingbeat shown (Hz) by kind. */
export const DRAGONFLY_WING_HZ: readonly [number, number, number] = [36, 30, 18];
/** ω by kind (rad/s): 2π·Hz, written as 2π·n / WING_TIME_WRAP with n whole so the shader's time wrap
 * is phase-continuous (`wingPlugin.ts`'s rule). */
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
 */
export const DRAGONFLY_COLOURS: readonly (readonly [number, number, number])[][] = [
  [[0.06, 0.26, 0.52], [0.14, 0.4, 0.16], [0.3, 0.2, 0.1]],
  [[0.4, 0.23, 0.08], [0.52, 0.14, 0.05]],
  [[0.08, 0.28, 0.72], [0.05, 0.34, 0.42]],
];

const KIND_NAMES = ["darner", "skimmer", "damselfly"] as const;
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
/** Salts for the per-individual wing phase and colourway, beside `dragonflyBehaviour.ts`'s in 70–79.
 * Apart, so an individual's colour and the beat of its wings are independent. */
const SALT_WING_PHASE = 75;
const SALT_COLOURWAY = 76;

/**
 * A kind's geometry, built in code: a body of two crossed quads (one upright, one flat) running the
 * kind's length along +z (head forward), and four wing quads hinged beside it, flat in the XZ plane,
 * the right pair at +x and the left at −x, so `wingPlugin.ts` rotates each about the body's axis by
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

/** One kind's mesh and its reused, doubling buffers — the bird bucket's shape (`wildlifeMeshes.ts`). */
type Bucket = {
  mesh: Mesh;
  material: PBRMaterial;
  /** Matrix data; capacity is `matrices.length / 16`. */
  matrices: Float32Array;
  /** Per-instance (phase, amp), stride 2, in lockstep with `matrices`. */
  wing: Float32Array;
  /** Per-instance RGBA colourway, stride 4, alpha always 1: under `INSTANCESCOLOR` the surface alpha
   * is the vertex alpha times this one, so 1 keeps the body opaque and the wings at their own. */
  tint: Float32Array;
  count: number;
  grown: boolean;
};

export type DragonflyMeshes = { readonly meshes: readonly Mesh[]; update(d: Dragonflies, seed: number): void; dispose(): void };

/**
 * The mesh a kind draws: white albedo over the vertex colours (the butterfly's convention), two-sided
 * because a card is seen from both sides, alpha-blended by its vertex alpha so the wings are
 * translucent, never a shadow caster, and always active (a bounding box synced to every instance
 * would rescan every matrix each frame).
 *
 * `now` is the clock (ms) the wings beat on; the wall clock absent.
 */
export function createDragonflyMeshes(scene: Scene, now?: () => number): DragonflyMeshes {
  const buckets: Bucket[] = [];
  for (let k = 0; k < 3; k++) {
    const name = KIND_NAMES[k]!;
    const mesh = new Mesh(`dragonfly_${name}`, scene);
    const geo = dragonflyGeometry(k);
    const data = new VertexData();
    data.positions = geo.positions;
    data.normals = geo.normals;
    data.colors = geo.colors;
    data.indices = geo.indices;
    data.applyToMesh(mesh, false);
    mesh.useVertexColors = true;
    mesh.hasVertexAlpha = true;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.setEnabled(false);
    const material = new PBRMaterial(`dragonfly_${name}_mat`, scene);
    material.albedoColor = new Color3(1, 1, 1);
    material.metallic = 0;
    material.roughness = 0.5;
    material.backFaceCulling = false;
    mesh.material = material;
    let halfSpan = 0;
    for (let i = 0; i < geo.positions.length; i += 3) halfSpan = Math.max(halfSpan, Math.abs(geo.positions[i]!));
    attachWing(material, halfSpan, DRAGONFLY_OMEGA[k]!, now);
    buckets.push({ mesh, material, matrices: EMPTY_BUFFER, wing: EMPTY_BUFFER, tint: EMPTY_BUFFER, count: 0, grown: false });
  }
  const meshes = buckets.map((b) => b.mesh);
  const scratchQ = new Quaternion();
  const scratchPos = new Vector3();
  const scratchMat = new Matrix();
  const unitScale = new Vector3(1, 1, 1);
  let disposed = false;

  /** Grows a bucket's buffers to hold `count` instances, doubling from `MIN_INSTANCES`, together under
   * one `grown` flag so their capacities never disagree. Old contents are dropped: every live
   * instance is rewritten straight after. */
  function ensureCapacity(b: Bucket): void {
    const needed = b.count * 16;
    if (b.matrices.length >= needed) {
      b.grown = false;
      return;
    }
    let capacity = Math.max(b.matrices.length, MIN_INSTANCES * 16);
    while (capacity < needed) capacity *= 2;
    b.matrices = new Float32Array(capacity);
    b.wing = new Float32Array((capacity / 16) * 2);
    b.tint = new Float32Array((capacity / 16) * 4);
    b.grown = true;
  }

  /** Pushes a filled bucket to its mesh: grown buffers set whole, otherwise the live prefix
   * re-uploaded; created updatable, and a bucket with nothing to draw disabled outright (with no
   * instances Babylon would draw the bare card once at the origin). */
  function apply(b: Bucket): void {
    const mesh = b.mesh;
    if (b.grown) {
      mesh.thinInstanceSetBuffer("matrix", b.matrices, 16, false);
      mesh.thinInstanceSetBuffer("wing", b.wing, 2, false);
      mesh.thinInstanceSetBuffer("color", b.tint, 4, false);
      mesh.thinInstanceCount = b.count;
    } else {
      mesh.thinInstanceCount = b.count;
      if (b.count > 0) {
        mesh.thinInstanceBufferUpdated("matrix");
        mesh.thinInstanceBufferUpdated("wing");
        mesh.thinInstanceBufferUpdated("color");
      }
    }
    mesh.setEnabled(b.count > 0);
  }

  return {
    meshes,
    update(d, seed) {
      if (disposed) return;
      for (let k = 0; k < 3; k++) {
        const b = buckets[k]!;
        const poses = d.poses[k]!;
        const n = Math.min(d.count[k]!, poses.length);
        b.count = n;
        ensureCapacity(b);
        const colourways = DRAGONFLY_COLOURS[k]!;
        for (let i = 0; i < n; i++) {
          const p = poses[i]!;
          Quaternion.RotationYawPitchRollToRef(p.yaw, -p.pitch, 0, scratchQ);
          scratchPos.copyFromFloats(p.x, p.y, p.z);
          Matrix.ComposeToRef(unitScale, scratchQ, scratchPos, scratchMat);
          scratchMat.copyToArray(b.matrices, i * 16);
          // Drawn from the individual's id, not its slot: the slot is wherever the range and the
          // presence left it this frame, the id is the same dragonfly every frame.
          b.wing[i * 2] = hash3(p.id, 0, SALT_WING_PHASE, seed) * 2 * Math.PI;
          b.wing[i * 2 + 1] = p.perched ? 0 : DRAGONFLY_WING_AMP;
          const colour = colourways[Math.floor(hash3(p.id, 0, SALT_COLOURWAY, seed) * colourways.length)]!;
          // Indexed, not destructured: destructuring makes an iterator per instance per frame.
          b.tint[i * 4] = colour[0]; b.tint[i * 4 + 1] = colour[1]; b.tint[i * 4 + 2] = colour[2]; b.tint[i * 4 + 3] = 1;
        }
        apply(b);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const b of buckets) {
        b.mesh.dispose();
        // Made here, so nothing else would ever free it (the butterfly's `ownedMaterials` note).
        b.material.dispose();
      }
    },
  };
}
