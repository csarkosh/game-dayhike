/**
 * The fingerposts at the trail's junctions as numbers and paint: the two
 * models' files, a plank's and a post's sizes, how high each plank hangs
 * and how tall its post is drawn, the lettering of a plank face as a canvas
 * takes it, the plank's inner end cut square, and where every post, plank
 * and label of a world stands. `lite/sceneryMeshes.ts`, which draws them,
 * keeps the meshes and the materials.
 *
 * Loads no engine: a canvas's context is the page's own.
 */
import type { SignPost } from "../sim/signs.js";
import { composeInto, matrixMultiply, quatFromEuler, type Quat } from "@csarkosh/engine/game/instancePose";
import { labelWear, type LabelWear } from "./labelWear.js";

export const SIGN_POST_OUTPUT = "models/sign.post.glb";
export const SIGN_ARM_OUTPUT = "models/sign.arm.glb";
/** One plank's label texture: one name on one line across a 1 m board, so wide and short. */
export const LABEL_TEXTURE = { width: 1024, height: 192 } as const;

/** The yaw that turns +z onto a unit direction, in the sim's convention (yaw 0 faces +z, PI/2 faces +x). */
export function armYaw(dir: { dx: number; dz: number }): number {
  return Math.atan2(dir.dx, dir.dz);
}

/** The arm model's length along +Z, post end to arrow tip. */
export const ARM_LENGTH = 1.095;
/** The arm model's height, centred on its origin. */
export const ARM_HEIGHT = 0.204;
/** The arm model's thickness across X: its two faces sit this far apart. */
export const ARM_THICKNESS = 0.038;
/** Where the arrow's point begins: the full-height board runs from the post end to here. */
export const ARM_BOARD_END = 0.95;
/**
 * How far from the footing's origin the post's shaft reaches at plank height,
 * with a few millimetres of air: a 20-sided section about 0.054 m from its
 * axis, the axis up to 7 mm off the origin.
 */
export const POST_REACH = 0.065;
/**
 * One label plane, in the texture's own 1024 : 192 shape so the letters are
 * not stretched. The texture keeps a 5% margin each side, so the letters
 * span 0.9 of its width: 0.756 m, the board seen between the post's reach and
 * where the arrow's point begins once the plank's squared end is on the
 * post's axis (0.8215 m out).
 */
export const LABEL_SIZE = { width: 0.84, height: 0.1575 } as const;
/**
 * Height of the bottom plank's centre above the post's foot. The planks have
 * no collider, so the bottom one's lower edge (1.648 m) sits above a hiker's
 * eye (1.6 m) and the camera never passes through a board.
 */
export const PLANK_BASE = 1.75;
/**
 * The rise from one plank to the next: the 0.204 m board and 11 mm of air, so
 * every plank of a post has a height of its own and no two boards cross,
 * whichever ways their arms point.
 */
export const PLANK_STEP = 0.215;
/** The post model's natural height, foot to top. */
export const POST_HEIGHT = 2.221;
/** How far the post's top stands above its highest plank's top edge. */
export const POST_CLEARANCE = 0.1;
/** The gap between a label and the arm face it sits on: enough to never fight it for depth. */
export const LABEL_LIFT = 0.001;
/** A label's material: matt, and nothing in it metal. */
export const LABEL_ROUGHNESS = 0.9;
/** The lettering: dark, like letters routed into weathered wood. */
const CARVED = "#24180c";
/** The lit lower lip of a routed letter, drawn a little below it. */
const CARVED_LIP = "rgba(236, 214, 170, 0.35)";

/**
 * Takes the wear out of painted lettering: soft patches of fade, then the
 * flakes, chips and scratches knocked clean through to the clear ground.
 */
export function scrape(ctx: CanvasRenderingContext2D, wear: LabelWear): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  for (const p of wear.patches) {
    const fade = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    fade.addColorStop(0, `rgba(0, 0, 0, ${p.strength})`);
    fade.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = fade;
    ctx.fillRect(p.x - p.r, p.y - p.r, 2 * p.r, 2 * p.r);
  }
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  for (const s of wear.specks) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, 2 * Math.PI);
    ctx.fill();
  }
  for (const c of wear.chips) {
    ctx.beginPath();
    for (const [k, pt] of c.points.entries()) {
      if (k === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.lineCap = "round";
  for (const s of wear.scratches) {
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Paints the lettering for one plank face onto `ctx`, over a box `width` by
 * `height` whose top left is the context's origin: dark bold letters on a
 * fully transparent ground, so the arm's own wood shows around and between
 * them and the text reads as cut into the board rather than stuck on it. One
 * line, centred, set as large as the height allows and then shrunk until it
 * fits the width inside a margin: one place name to a board reads from a few
 * paces with a lamp. The paint is worn (`labelWear`): faded unevenly,
 * flaked, chipped and scratched along the grain, the same way for the same
 * name on every peer.
 */
export function paintLabel(ctx: CanvasRenderingContext2D, text: string, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  const margin = width * 0.05;
  const family = `"Trebuchet MS", "Helvetica Neue", Arial, sans-serif`;
  let size = Math.round(height * 0.62);
  ctx.font = `bold ${size}px ${family}`;
  const measured = ctx.measureText(text).width;
  if (measured > width - 2 * margin) {
    size = Math.max(12, Math.floor((size * (width - 2 * margin)) / measured));
    ctx.font = `bold ${size}px ${family}`;
  }
  const metrics = ctx.measureText(text);
  const x = (width - metrics.width) / 2;
  // A capital's middle sits about 0.35 em above the baseline.
  const baseline = height / 2 + size * 0.35;
  const lip = Math.max(1, Math.round(size * 0.04));
  const ascent = metrics.actualBoundingBoxAscent || size * 0.75;
  const descent = metrics.actualBoundingBoxDescent || size * 0.2;
  const top = Math.max(0, baseline - ascent);
  const ink = { x, y: top, width: metrics.width, height: Math.min(height, baseline + descent + lip) - top };
  const wear = labelWear(text, ink);
  // Letter by letter, so each carries its own share of the faded ink.
  const chars = Array.from(text);
  for (const [i, char] of chars.entries()) {
    const at = x + ctx.measureText(chars.slice(0, i).join("")).width;
    ctx.globalAlpha = wear.alpha * (wear.letters[i] as number);
    ctx.fillStyle = CARVED_LIP;
    ctx.fillText(char, at, baseline + lip);
    ctx.fillStyle = CARVED;
    ctx.fillText(char, at, baseline);
  }
  ctx.globalAlpha = 1;
  scrape(ctx, wear);
}

/** How many planks a post carries: one per name, across all its arms. */
export function plankCount(post: SignPost): number {
  let n = 0;
  for (const arm of post.arms) n += arm.names.length;
  return n;
}

/**
 * The centre height of the plank `rank` places from the top of a post with
 * `count` planks: the top plank highest, the last at `PLANK_BASE`.
 */
export function plankHeight(rank: number, count: number): number {
  return PLANK_BASE + PLANK_STEP * (count - 1 - rank);
}

/**
 * How tall a post with `count` planks is drawn: its top `POST_CLEARANCE`
 * above the highest plank's top edge, and never shorter than the model.
 */
export function postHeight(count: number): number {
  if (count === 0) return POST_HEIGHT;
  return Math.max(POST_HEIGHT, plankHeight(0, count) + ARM_HEIGHT / 2 + POST_CLEARANCE);
}

/**
 * How far along a plank from its origin a label's middle sits, for a plank
 * whose squared end is `end` along it: centred on the board seen between the
 * post and the arrow's point, measured from the post's axis, where the
 * squared end is.
 */
export function labelAlong(end: number): number {
  return end + (POST_REACH + ARM_BOARD_END - end) / 2;
}

/** A plank's geometry as its end is cut: xyz a vertex of position and of normal, three indices a triangle. */
export type PlankGeometry = { positions: Float32Array; normals: Float32Array | null; indices: ArrayLike<number> };

/**
 * A vertex's normal from the faces that meet at it, each face counting once
 * whatever its size, as Babylon.js's `VertexData.ComputeNormals` makes them:
 * xyz a vertex, a vertex on no face left at nothing.
 */
export function faceNormals(positions: ArrayLike<number>, indices: ArrayLike<number>): Float64Array {
  const normals = new Float64Array(positions.length);
  const p = (v: number, k: number): number => positions[3 * v + k] as number;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] as number, b = indices[t + 1] as number, c = indices[t + 2] as number;
    const p1p2x = p(a, 0) - p(b, 0), p1p2y = p(a, 1) - p(b, 1), p1p2z = p(a, 2) - p(b, 2);
    const p3p2x = p(c, 0) - p(b, 0), p3p2y = p(c, 1) - p(b, 1), p3p2z = p(c, 2) - p(b, 2);
    let nx = p1p2y * p3p2z - p1p2z * p3p2y;
    let ny = p1p2z * p3p2x - p1p2x * p3p2z;
    let nz = p1p2x * p3p2y - p1p2y * p3p2x;
    let length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    length = length === 0 ? 1 : length;
    nx /= length;
    ny /= length;
    nz /= length;
    for (const v of [a, b, c]) {
      normals[3 * v] = (normals[3 * v] as number) + nx;
      normals[3 * v + 1] = (normals[3 * v + 1] as number) + ny;
      normals[3 * v + 2] = (normals[3 * v + 2] as number) + nz;
    }
  }
  for (let i = 0; i + 2 < normals.length; i += 3) {
    const nx = normals[i] as number, ny = normals[i + 1] as number, nz = normals[i + 2] as number;
    let length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    length = length === 0 ? 1 : length;
    normals[i] = nx / length;
    normals[i + 1] = ny / length;
    normals[i + 2] = nz / length;
  }
  return normals;
}

/**
 * Cuts a plank's inner end square, in place, so it meets the post cleanly:
 * the end the model comes with is a V notch, whose two points would stand
 * out beside a post as thin as this one. Every vertex behind the notch's
 * apex (the nearest point on the board's centre line) moves forward to it,
 * so the end becomes flat; the faces that turn to face the post get their
 * normals worked out again, and the texture coordinates stay as they were.
 * The plank runs along +z with its centre line at y = 0. Returns the apex's
 * distance along the plank, where the flat end now is, and how many vertices
 * moved to it; null for a mesh with no vertex on the centre line, which is
 * left as it is.
 */
export function squareEnd(geometry: PlankGeometry): { end: number; moved: number } | null {
  const { positions, normals, indices } = geometry;
  // The apex: the nearest vertex to the post end on the centre line (y = 0).
  let cut = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i + 1] as number) < 1e-4) cut = Math.min(cut, positions[i + 2] as number);
  }
  if (!Number.isFinite(cut)) return null;
  const moved = new Set<number>();
  for (let v = 0; v < positions.length / 3; v++) {
    if ((positions[3 * v + 2] as number) < cut) {
      positions[3 * v + 2] = cut;
      moved.add(v);
    }
  }
  if (moved.size === 0 || normals === null) return { end: cut, moved: moved.size };
  // Fresh normals for every face that moved; the rest keep the model's own.
  const fresh = faceNormals(positions, indices);
  // The file's triangles may wind the other way from the computation's own
  // convention: take the sign that agrees with the model's normals on the
  // faces that did not move.
  let agree = 0;
  for (let v = 0; v < positions.length / 3; v++) {
    if (moved.has(v)) continue;
    for (let k = 0; k < 3; k++) agree += (fresh[3 * v + k] as number) * (normals[3 * v + k] as number);
  }
  const sign = agree < 0 ? -1 : 1;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const tri = [indices[t] as number, indices[t + 1] as number, indices[t + 2] as number];
    if (!tri.some((v) => moved.has(v))) continue;
    for (const v of tri) {
      const n = [fresh[3 * v] as number, fresh[3 * v + 1] as number, fresh[3 * v + 2] as number];
      // A vertex left only on faces the cut flattened to nothing keeps its own.
      if (Math.hypot(n[0] as number, n[1] as number, n[2] as number) < 0.5) continue;
      for (let k = 0; k < 3; k++) normals[3 * v + k] = sign * (n[k] as number);
    }
  }
  return { end: cut, moved: moved.size };
}

/** The floats of a matrix: sixteen, as a shader reads them. */
const M = 16;

/** One post's share of a world's signs: which of the planks and of the label faces are its own. */
export type PostPlace = {
  /** The post's foot. */
  x: number;
  y: number;
  z: number;
  /** How tall it is drawn (`postHeight`). */
  height: number;
  /** Its planks among `SignPlaces.planks`: the first, and how many. */
  plank: number;
  planks: number;
};

/** One face of a plank's lettering: the name it carries, and its four corners in the world. */
export type LabelFace = {
  name: string;
  /** xyz a corner: bottom left, bottom right, top right, top left, as the face is read. */
  corners: Float32Array;
  /** The way the face looks: a unit vector. */
  normal: { x: number; y: number; z: number };
};

/** Where every post, plank and label of a world stands. */
export type SignPlaces = {
  posts: PostPlace[];
  /** A post's matrix, sixteen floats a post: its foot on the ground, stretched up to its height. */
  postMatrices: Float32Array;
  /** A plank's matrix, sixteen floats a plank, the posts' planks one post after another. */
  plankMatrices: Float32Array;
  /** Two faces a plank, in the planks' order: the face on the plank's +x side, then the one on its -x side. */
  labels: LabelFace[];
  /** Every place named, once, in the order the planks first name them. */
  names: string[];
};

const scratchQuat: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** The matrix of a place turned by `yaw` about the vertical, stretched by `sy`, at (x, y, z). */
function placed(out: Float32Array, offset: number, x: number, y: number, z: number, yaw: number, sy = 1): void {
  composeInto(out, offset, 1, sy, 1, quatFromEuler(0, yaw, 0, scratchQuat), x, y, z);
}

/**
 * Where `posts` stand on ground `groundH`, for a plank whose squared end is
 * `end` along it (`squareEnd`): each post at its foot, stretched to stand
 * above its highest plank; each plank's squared end on its post's axis, at
 * its own height, pointing down its arm; and on each face of each plank its
 * lettering, a millimetre off the face, read from outside it.
 */
export function signPlaces(posts: readonly SignPost[], groundH: (x: number, z: number) => number, end: number): SignPlaces {
  const total = posts.reduce((n, post) => n + plankCount(post), 0);
  const out: SignPlaces = {
    posts: [], postMatrices: new Float32Array(posts.length * M), plankMatrices: new Float32Array(total * M), labels: [], names: [],
  };
  const along = labelAlong(end);
  const face = new Float32Array(M);
  const world = new Float32Array(M);
  let plank = 0;
  for (const [p, post] of posts.entries()) {
    const count = plankCount(post);
    const y = groundH(post.x, post.z);
    const height = postHeight(count);
    placed(out.postMatrices, p * M, post.x, y, post.z, 0, height / POST_HEIGHT);
    out.posts.push({ x: post.x, y, z: post.z, height, plank, planks: count });
    for (const arm of post.arms) {
      for (const [k, name] of arm.names.entries()) {
        const rank = arm.ranks[k] as number;
        const at = plank * M;
        placed(out.plankMatrices, at, post.x - arm.dx * end, y + plankHeight(rank, count), post.z - arm.dz * end, armYaw(arm));
        if (!out.names.includes(name)) out.names.push(name);
        for (const side of [1, -1] as const) {
          // A plane faces -z as it is made; a quarter turn one way or the other points it out of its face.
          placed(face, 0, side * (ARM_THICKNESS / 2 + LABEL_LIFT), 0, along, -side * (Math.PI / 2));
          matrixMultiply(out.plankMatrices.subarray(at, at + M), face, world);
          const corners = new Float32Array(12);
          const hw = LABEL_SIZE.width / 2, hh = LABEL_SIZE.height / 2;
          for (const [c, [cx, cy]] of ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const).entries()) {
            for (let row = 0; row < 3; row++) {
              corners[c * 3 + row] = (world[row] as number) * cx + (world[4 + row] as number) * cy + (world[12 + row] as number);
            }
          }
          out.labels.push({ name, corners, normal: { x: -(world[8] as number), y: -(world[9] as number), z: -(world[10] as number) } });
        }
        plank++;
      }
    }
  }
  return out;
}
