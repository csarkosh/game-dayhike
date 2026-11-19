/**
 * The handset's cord as geometry, with no engine: a thin tube along the
 * path the stage lays, a ring of vertices at each of the path's points.
 *
 * It is the tube Babylon.js makes for the same path (`CreateTube`, six
 * sides, no caps) as it stands after the path is laid again, float for
 * float: each ring's frame is carried along the path from the one before
 * (the tangent the sum of the two segments at a point, the normal the last
 * binormal crossed with it), a ring's first vertex is repeated as its last
 * so the seam has a vertex either side, and a vertex's normal is the sum of
 * its faces' unit normals, the seam's two halved together. So a
 * renderer that writes its own mesh draws that cord.
 *
 * The triangles never change: a cord laid again writes positions and
 * normals alone, into the arrays it was made with.
 *
 * Loads no engine.
 */

/** The cord's own thickness: its radius (m). */
export const CORD_TUBE_RADIUS = 0.0018;
/** The sides of the tube's ring. */
export const CORD_TUBE_SIDES = 6;

type Point = { readonly x: number; readonly y: number; readonly z: number };

/** A tube's vertices as a mesh takes them: xyz a vertex of position and of normal, and the triangles. */
export type TubeGeometry = {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** The path's points, a ring each. */
  readonly rings: number;
  readonly sides: number;
};

/** How far from 1 a share of a tangent may be and still count as all of it. */
const AXIS_EPSILON = 0.001;

/** A tube of `rings` rings of `sides` sides: its triangles listed, its vertices nowhere yet (`layTube`). */
export function createTubeGeometry(rings: number, sides = CORD_TUBE_SIDES): TubeGeometry {
  const around = sides + 1;
  const indices = new Uint32Array(Math.max(0, rings - 1) * sides * 6);
  let i = 0;
  for (let ring = 0; ring + 1 < rings; ring++) {
    for (let side = 0; side < sides; side++) {
      const a = ring * around + side;
      indices[i++] = a;
      indices[i++] = a + around;
      indices[i++] = a + 1;
      indices[i++] = a + around + 1;
      indices[i++] = a + 1;
      indices[i++] = a + around;
    }
  }
  return { positions: new Float32Array(rings * around * 3), normals: new Float32Array(rings * around * 3), indices, rings, sides };
}

/** The frames along a path, kept between two lays so a lay makes nothing. */
type Frames = { tangents: Float64Array; normals: Float64Array; binormals: Float64Array };
const framesBySize = new Map<number, Frames>();
const rotation = new Float32Array(9);

/** `v` scaled to a unit vector in place, as it stands where its length is nothing or one. */
function normalize(v: Float64Array, at: number): void {
  const x = v[at] as number, y = v[at + 1] as number, z = v[at + 2] as number;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length === 0 || length === 1) return;
  const k = 1 / length;
  v[at] = x * k;
  v[at + 1] = y * k;
  v[at + 2] = z * k;
}

function cross(a: Float64Array, ai: number, b: Float64Array, bi: number, out: Float64Array, oi: number): void {
  const ax = a[ai] as number, ay = a[ai + 1] as number, az = a[ai + 2] as number;
  const bx = b[bi] as number, by = b[bi + 1] as number, bz = b[bi + 2] as number;
  out[oi] = ay * bz - az * by;
  out[oi + 1] = az * bx - ax * bz;
  out[oi + 2] = ax * by - ay * bx;
}

/** The first segment from point `index` that has a length, into `out`. */
function segmentAhead(path: readonly Point[], index: number, out: Float64Array, at: number): void {
  let i = 1;
  const from = path[index] as Point;
  let to = path[index + i] as Point;
  while (to.x - from.x === 0 && to.y - from.y === 0 && to.z - from.z === 0 && index + i + 1 < path.length) {
    i++;
    to = path[index + i] as Point;
  }
  out[at] = to.x - from.x;
  out[at + 1] = to.y - from.y;
  out[at + 2] = to.z - from.z;
}

/** The last segment into point `index` that has a length, into `out`. */
function segmentBehind(path: readonly Point[], index: number, out: Float64Array, at: number): void {
  let i = 1;
  const to = path[index] as Point;
  let from = path[index - i] as Point;
  while (to.x - from.x === 0 && to.y - from.y === 0 && to.z - from.z === 0 && index > i + 1) {
    i++;
    from = path[index - i] as Point;
  }
  out[at] = to.x - from.x;
  out[at + 1] = to.y - from.y;
  out[at + 2] = to.z - from.z;
}

const scratch = new Float64Array(9);

/**
 * Lays `tube` along `path`, a ring of `radius` at each point: its positions
 * and its normals written in place. The path has as many points as the tube
 * has rings.
 */
export function layTube(path: readonly Point[], radius: number, tube: TubeGeometry): void {
  const l = tube.rings;
  if (path.length !== l) throw new Error(`a tube of ${l} rings laid along ${path.length} points`);
  if (l < 2) return;
  let frames = framesBySize.get(l);
  if (frames === undefined) {
    frames = { tangents: new Float64Array(l * 3), normals: new Float64Array(l * 3), binormals: new Float64Array(l * 3) };
    framesBySize.set(l, frames);
  }
  const { tangents, normals, binormals } = frames;
  // The first and the last tangents: the path's own first and last segments.
  segmentAhead(path, 0, tangents, 0);
  normalize(tangents, 0);
  const last = path[l - 1] as Point, before = path[l - 2] as Point;
  tangents[(l - 1) * 3] = last.x - before.x;
  tangents[(l - 1) * 3 + 1] = last.y - before.y;
  tangents[(l - 1) * 3 + 2] = last.z - before.z;
  normalize(tangents, (l - 1) * 3);
  // The first normal: across the tangent from straight down, or from an axis the tangent does not lie along.
  const tx = tangents[0] as number, ty = tangents[1] as number, tz = tangents[2] as number;
  let length = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (length === 0) length = 1;
  const along = (share: number): boolean => Math.abs(Math.abs(share) / length - 1) <= AXIS_EPSILON;
  scratch[0] = 0;
  scratch[1] = 0;
  scratch[2] = 0;
  if (!along(ty)) scratch[1] = -1;
  else if (!along(tx)) scratch[0] = 1;
  else if (!along(tz)) scratch[2] = 1;
  cross(tangents, 0, scratch, 0, normals, 0);
  normalize(normals, 0);
  normalize(normals, 0);
  cross(tangents, 0, normals, 0, binormals, 0);
  normalize(binormals, 0);
  for (let i = 1; i < l; i++) {
    const at = i * 3;
    if (i < l - 1) {
      segmentBehind(path, i, scratch, 0);
      segmentAhead(path, i, scratch, 3);
      tangents[at] = (scratch[0] as number) + (scratch[3] as number);
      tangents[at + 1] = (scratch[1] as number) + (scratch[4] as number);
      tangents[at + 2] = (scratch[2] as number) + (scratch[5] as number);
      normalize(tangents, at);
    }
    cross(binormals, at - 3, tangents, at, normals, at);
    const nx = normals[at] as number, ny = normals[at + 1] as number, nz = normals[at + 2] as number;
    if (Math.sqrt(nx * nx + ny * ny + nz * nz) === 0) {
      normals[at] = normals[at - 3] as number;
      normals[at + 1] = normals[at - 2] as number;
      normals[at + 2] = normals[at - 1] as number;
    } else {
      normalize(normals, at);
    }
    cross(tangents, at, normals, at, binormals, at);
    normalize(binormals, at);
  }

  // The rings: each point's normal turned about its tangent, a side at a time.
  const { positions, sides } = tube;
  const around = sides + 1;
  const step = (Math.PI * 2) / sides;
  for (let i = 0; i < l; i++) {
    const at = i * 3;
    const point = path[i] as Point;
    let ax = tangents[at] as number, ay = tangents[at + 1] as number, az = tangents[at + 2] as number;
    const axis = Math.sqrt(ax * ax + ay * ay + az * az);
    if (axis !== 0 && axis !== 1) {
      const k = 1 / axis;
      ax *= k;
      ay *= k;
      az *= k;
    }
    const nx = normals[at] as number, ny = normals[at + 1] as number, nz = normals[at + 2] as number;
    const ring = i * around * 3;
    for (let t = 0; t < sides; t++) {
      const s = Math.sin(-(step * t));
      const c = Math.cos(-(step * t));
      const c1 = 1 - c;
      // The turn's matrix as single floats, as Babylon.js keeps a matrix.
      rotation[0] = ax * ax * c1 + c;
      rotation[1] = ax * ay * c1 - az * s;
      rotation[2] = ax * az * c1 + ay * s;
      rotation[3] = ay * ax * c1 + az * s;
      rotation[4] = ay * ay * c1 + c;
      rotation[5] = ay * az * c1 - ax * s;
      rotation[6] = az * ax * c1 - ay * s;
      rotation[7] = az * ay * c1 + ax * s;
      rotation[8] = az * az * c1 + c;
      const rx = nx * (rotation[0] as number) + ny * (rotation[3] as number) + nz * (rotation[6] as number);
      const ry = nx * (rotation[1] as number) + ny * (rotation[4] as number) + nz * (rotation[7] as number);
      const rz = nx * (rotation[2] as number) + ny * (rotation[5] as number) + nz * (rotation[8] as number);
      positions[ring + t * 3] = rx * radius + point.x;
      positions[ring + t * 3 + 1] = ry * radius + point.y;
      positions[ring + t * 3 + 2] = rz * radius + point.z;
    }
    // The seam: the ring's first vertex again.
    positions[ring + sides * 3] = positions[ring] as number;
    positions[ring + sides * 3 + 1] = positions[ring + 1] as number;
    positions[ring + sides * 3 + 2] = positions[ring + 2] as number;
  }
  tubeNormals(tube);
}

/** A tube's normals from its positions: each vertex the sum of its faces' unit normals, the seam's two vertices halved together. */
function tubeNormals(tube: TubeGeometry): void {
  const { positions, normals, indices, rings, sides } = tube;
  normals.fill(0);
  for (let f = 0; f + 2 < indices.length; f += 3) {
    const a = (indices[f] as number) * 3, b = (indices[f + 1] as number) * 3, c = (indices[f + 2] as number) * 3;
    const p1x = (positions[a] as number) - (positions[b] as number);
    const p1y = (positions[a + 1] as number) - (positions[b + 1] as number);
    const p1z = (positions[a + 2] as number) - (positions[b + 2] as number);
    const p3x = (positions[c] as number) - (positions[b] as number);
    const p3y = (positions[c + 1] as number) - (positions[b + 1] as number);
    const p3z = (positions[c + 2] as number) - (positions[b + 2] as number);
    let fx = p1y * p3z - p1z * p3y;
    let fy = p1z * p3x - p1x * p3z;
    let fz = p1x * p3y - p1y * p3x;
    let length = Math.sqrt(fx * fx + fy * fy + fz * fz);
    length = length === 0 ? 1 : length;
    fx /= length;
    fy /= length;
    fz /= length;
    for (const v of [a, b, c]) {
      normals[v] = (normals[v] as number) + fx;
      normals[v + 1] = (normals[v + 1] as number) + fy;
      normals[v + 2] = (normals[v + 2] as number) + fz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const x = normals[v] as number, y = normals[v + 1] as number, z = normals[v + 2] as number;
    let length = Math.sqrt(x * x + y * y + z * z);
    length = length === 0 ? 1 : length;
    normals[v] = x / length;
    normals[v + 1] = y / length;
    normals[v + 2] = z / length;
  }
  const around = sides + 1;
  for (let ring = 0; ring < rings; ring++) {
    const first = ring * around * 3;
    const seam = first + sides * 3;
    for (let k = 0; k < 3; k++) {
      normals[first + k] = ((normals[first + k] as number) + (normals[seam + k] as number)) * 0.5;
      normals[seam + k] = normals[first + k] as number;
    }
  }
}
